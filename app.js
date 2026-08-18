const API_BASE_URL = "https://radio-asian-enormous-participate.trycloudflare.com";
let pageGroups=[], currentIndex=0, currentCoords=[], currentImg=null;
let currentDigitalData = null;
let currentSearchQuery = '';
let currentMode = 'exact';

document.addEventListener('DOMContentLoaded', () => {
    // --- CUSTOM ALERT FUNCTION ---
    const customAlertModal = document.getElementById('customAlertModal');
    const customAlertMessage = document.getElementById('customAlertMessage');
    const customAlertOkBtn = document.getElementById('customAlertOkBtn');
    
    window.showCustomAlert = function(message) {
        customAlertMessage.textContent = message;
        // Brute-force the display to flex, bypassing CSS entirely
        customAlertModal.style.display = 'flex'; 
    };
    
    customAlertOkBtn.addEventListener('click', () => {
        // Brute-force it back to hidden
        customAlertModal.style.display = 'none'; 
    });

  const searchInput        = document.getElementById('searchInput');
  const searchBtn          = document.getElementById('searchBtn');
  const searchBookSelect   = document.getElementById('searchBookSelect');
  const searchPageInput    = document.getElementById('searchPageInput');
  const loadingMsg         = document.getElementById('loadingMsg');
  const resultCounter      = document.getElementById('resultCounter');
  const prevBtn            = document.getElementById('prevBtn');
  const nextBtn            = document.getElementById('nextBtn');
  const emptyState         = document.getElementById('emptyState');
  const resultImage        = document.getElementById('resultImage');
  const highlightOverlay   = document.getElementById('highlightOverlay');
  const leftImage          = document.getElementById('leftImage');
  const leftImageContainer = document.getElementById('leftImageContainer');
  const documentMetadata   = document.getElementById('documentMetadata');
  const metaBookTitle      = document.getElementById('metaBookTitle');
  const metaPageNum        = document.getElementById('metaPageNum');
  const plIdle             = document.getElementById('plIdle');
  const plStatus           = document.getElementById('plStatus');
  const rIdle              = document.getElementById('rIdle');
  
  currentImg = leftImage;
  
  // --- NEW: Populate Book Dropdown on Load ---
  if (searchBookSelect) {
      fetch(`${API_BASE_URL}/admin/books`)
          .then(r => r.json())
          .then(data => {
              if (data.books) {
                  data.books.forEach(b => {
                      const opt = document.createElement('option');
                      opt.value = b;
                      opt.textContent = b.replace(/_/g, ' ');
                      searchBookSelect.appendChild(opt);
                  });
                  // Restore dropdown selection if page was refreshed
                  const savedBook = sessionStorage.getItem('searchBook');
                  if (savedBook) searchBookSelect.value = savedBook;
              }
          })
          .catch(e => console.log('Could not load books'));
  }

  searchBtn.addEventListener('click', executeSearch);
  searchInput.addEventListener('keypress', e => { if(e.key==='Enter') executeSearch(); });
  if(searchPageInput) searchPageInput.addEventListener('keypress', e => { if(e.key==='Enter') executeSearch(); });

  function executeSearch(eventOrQuery = null, savedIdx = 0){
    let query = searchInput.value.trim();
    if (typeof eventOrQuery === 'string') query = eventOrQuery;
    
    let bookId = searchBookSelect ? searchBookSelect.value : 'all';
    let pageNum = searchPageInput ? searchPageInput.value.trim() : '';

    // If both the keyword and the page number are empty, do nothing
    if(!query && !pageNum) return;
    
    currentSearchQuery = query; 
    sessionStorage.setItem('searchQuery', query); 
    sessionStorage.setItem('searchBook', bookId);
    sessionStorage.setItem('searchPage', pageNum);
    
    searchBtn.disabled = true;
    loadingMsg.style.display = 'flex';
    emptyState.style.display = 'none';
    resultImage.style.display = 'none';
    leftImageContainer.style.display = 'none';
    plIdle.style.display = 'flex';
    plStatus.classList.remove('on');
    highlightOverlay.textContent = '';
    resultCounter.style.display = 'none';
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
    documentMetadata.style.display = 'none';
    rIdle.style.display = 'none';
    
    // NEW: Pass all three parameters to the backend
    let fetchUrl = `${API_BASE_URL}/search?query=${encodeURIComponent(query)}&book_id=${encodeURIComponent(bookId)}&page=${encodeURIComponent(pageNum)}`;
    
    fetch(fetchUrl)
      .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
      .then(data=>{
        if(data.length===0){
          rIdle.style.display='flex';
          emptyState.textContent='No results found for this query.';
          emptyState.style.display='block'; return;
        }
        const g={};
        data.forEach(item=>{ if(!g[item.image_url]) g[item.image_url]=[]; g[item.image_url].push(item); });
        pageGroups=Object.values(g); 
        currentIndex = Math.min(savedIdx, pageGroups.length - 1);
        sessionStorage.setItem('searchPageIdx', currentIndex);
        renderPage(currentIndex);
      })
      .catch(()=>{
        rIdle.style.display='flex';
        emptyState.textContent='Cannot connect — ensure main.py is running.';
        emptyState.style.display='block';
      })
      .finally(()=>{ searchBtn.disabled=false; loadingMsg.style.display='none'; });
  }
  
  function renderPage(idx){
    const pd=pageGroups[idx];
    if(!pd||!pd.length) return;
    currentCoords=pd; rIdle.style.display='none';
    metaBookTitle.textContent=pd[0].book_id;
    metaPageNum.textContent=pd[0].page_number.replace('_',' ').toUpperCase();
    documentMetadata.style.display='flex';
    resultCounter.textContent=`${idx+1} of ${pageGroups.length}`;
    resultCounter.style.display='inline-block';
    prevBtn.style.display=idx>0?'inline-block':'none';
    nextBtn.style.display=idx<pageGroups.length-1?'inline-block':'none';
    emptyState.style.display='none';
    highlightOverlay.textContent=''; 
    const targetUrl = `${API_BASE_URL}${encodeURI(pd[0].image_url)}`;
    leftImageContainer.style.display='block'; plIdle.style.display='none';
    plStatus.textContent=pd[0].page_number.replace('_',' ').toUpperCase(); plStatus.classList.add('on');
    
    function attemptLoad(attempts) {
        leftImage.onload = () => drawHL(leftImage, currentCoords, highlightOverlay);
        leftImage.onerror = () => {
            // If the server is congested, wait 3 seconds and try again silently
            setTimeout(() => { attemptLoad(attempts + 1); }, 3000);
        };
        // Adding "?retry=" forces the browser to actually request it again instead of giving up
        leftImage.src = targetUrl + "?retry=" + attempts; 
    }
    attemptLoad(0);
  }
  
  function drawHL(imgEl, coords, overlayEl) {
    overlayEl.innerHTML = '';
  }
  
  prevBtn.addEventListener('click',()=>{ 
      if(currentIndex>0){
          currentIndex--;
          sessionStorage.setItem('searchPageIdx', currentIndex);
          renderPage(currentIndex);
      } 
  });
  nextBtn.addEventListener('click',()=>{ 
      if(currentIndex<pageGroups.length-1){
          currentIndex++;
          sessionStorage.setItem('searchPageIdx', currentIndex);
          renderPage(currentIndex);
      } 
  });
  
  let rt;
  window.addEventListener('resize',()=>{
    clearTimeout(rt); rt=setTimeout(()=>{
      if(!currentImg||!currentCoords.length||leftImageContainer.style.display==='none') return;
      drawHL(leftImage, currentCoords, highlightOverlay);
      if(readerModal.classList.contains('open')) {
         drawHL(modalImage, currentDigitalData, modalHighlightOverlay);
      }
    },150);
  });
  
  const aboutModal   = document.getElementById('aboutModal');
  const openAboutBtn = document.getElementById('openAboutBtn');
  const closeAboutBtn= document.getElementById('closeAboutBtn');
  openAboutBtn.addEventListener('click',()=>aboutModal.classList.add('open'));
  closeAboutBtn.addEventListener('click',()=>aboutModal.classList.remove('open'));
  aboutModal.addEventListener('click',e=>{ if(e.target===aboutModal) aboutModal.classList.remove('open'); });
  
  const readerModal           = document.getElementById('readerModal');
  const modalImage            = document.getElementById('modalImage');
  const closeModalBtn         = document.getElementById('closeModalBtn');
  const prevBookPage          = document.getElementById('prevBookPage');
  const nextBookPage          = document.getElementById('nextBookPage');
  const modalCaption          = document.getElementById('modalCaption');
  const modalDocTitle         = document.getElementById('modalDocTitle');
  const modalHighlightOverlay = document.getElementById('modalHighlightOverlay');
  
  const btnReadMode           = document.getElementById('btnReadMode');
  const btnCopyText           = document.getElementById('btnCopyText');
  const copyMsg               = document.getElementById('copyMsg');
  
  const btnSuggestEdit        = document.getElementById('btnSuggestEdit');
  const btnCancelEdit         = document.getElementById('btnCancelEdit');
  const btnSubmitEdit         = document.getElementById('btnSubmitEdit');
  
  const rmRightContent        = document.getElementById('rmRightContent');
  const rmLoading             = document.getElementById('rmLoading');
  const rmError               = document.getElementById('rmError');
  const rmReadContainer       = document.getElementById('rmReadContainer');
  const rmEditContainer       = document.getElementById('rmEditContainer');
  
  let currentReaderUrl='';
  
  leftImageContainer.addEventListener('click',()=>{
    if(!leftImage.src||leftImageContainer.style.display==='none') return;
    currentReaderUrl=leftImage.src;
    openModal(currentReaderUrl);
  });
  closeModalBtn.addEventListener('click',()=> {
      readerModal.classList.remove('open');
      sessionStorage.removeItem('readerUrl');
  });
  readerModal.addEventListener('click',e=>{ 
      if(e.target===readerModal) {
          readerModal.classList.remove('open');
          sessionStorage.removeItem('readerUrl');
      }
  });
  
  document.addEventListener('keydown', e => {
    if(aboutModal.classList.contains('open')){ if(e.key==='Escape') aboutModal.classList.remove('open'); return; }
    if(!readerModal.classList.contains('open')) return;
    
    if(e.key==='Escape') {
        readerModal.classList.remove('open');
        sessionStorage.removeItem('readerUrl');
        return;
    }
    
    if(e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if(e.key==='ArrowLeft')  turnBookPage(-1);
    if(e.key==='ArrowRight') turnBookPage(1);
  });
  
  function openModal(url){
    sessionStorage.setItem('readerUrl', url);
    modalImage.src = url;
    readerModal.classList.add('open');
    
    // FIX: Strip off the "?retry=0" parameter so it doesn't show up in the title!
    const cleanUrl = url.split('?')[0]; 
    const parts = cleanUrl.split('/');
    const fn = parts[parts.length-1];
    const bookId = decodeURIComponent(parts[parts.length-2]);
    
    modalCaption.textContent = decodeURI(fn).replace('.jpg','').replace(/_/g,' ').toUpperCase();
    modalDocTitle.textContent = metaBookTitle.textContent || 'Document Reader';
    loadDigitalPage(bookId, fn);
  }
  
  function turnBookPage(dir){
    const rx=/page_(\d+)\.jpg/i, m=currentReaderUrl.match(rx);
    if(!m) return;
    let pg=parseInt(m[1])+dir; if(pg<1) return;
    const nu=currentReaderUrl.replace(rx,`page_${pg}.jpg`);
    const t = new Image();
    function attemptTurn(attempts) {
        t.onload = () => { currentReaderUrl = nu; openModal(nu); };
        t.onerror = () => {
            // Keep knocking every 3 seconds until the pipe clears
            setTimeout(() => { attemptTurn(attempts + 1); }, 3000);
        };
        t.src = nu + "?retry=" + attempts;
    }
    attemptTurn(0);
  }
  prevBookPage.addEventListener('click',()=>turnBookPage(-1));
  nextBookPage.addEventListener('click',()=>turnBookPage(1));
  
  function parseOCRData(data) {
    let words = data.filter(w => w.word.trim() !== '');
    if (!words.length) return { paragraphs: [], medH: 15 };
    const heights = words.map(w => w.height).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 15;
    const widths = words.map(w => w.width).sort((a, b) => a - b);
    const medW = widths[Math.floor(widths.length / 2)] || medH;
    words.sort((a, b) => a.top - b.top || a.left - b.left);
    
    const isShortToken = w => /^[0-9ivxlcdm]{1,3}[.)]?$/i.test(w.word.trim());
    let cleanWords = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!isShortToken(w)) { cleanWords.push(w); continue; }
        let nearestGap = Infinity;
        for (let j = 0; j < words.length; j++) {
            if (j === i) continue;
            const other = words[j];
            if (Math.abs(other.top - w.top) > medH * 0.6) continue;
            const gap = other.left > w.left
                ? other.left - (w.left + w.width)
                : w.left - (other.left + other.width);
            if (gap >= 0 && gap < nearestGap) nearestGap = gap;
        }
        const isIsolated = nearestGap === Infinity || nearestGap > medW * 2.5;
        if (isIsolated) continue; 
        cleanWords.push(w);
    }
    if (!cleanWords.length) cleanWords = words;
    
    let lines = [];
    let currentLine = [];
    let anchorTop = null;
    cleanWords.forEach(w => {
        if (anchorTop === null || Math.abs(w.top - anchorTop) <= medH * 0.5) {
            currentLine.push(w);
            if (anchorTop === null) anchorTop = w.top;
        } else {
            lines.push(currentLine);
            currentLine = [w];
            anchorTop = w.top;
        }
    });
    if (currentLine.length) lines.push(currentLine);
    lines.forEach(line => line.sort((a, b) => a.left - b.left));
    lines.sort((a, b) => Math.min(...a.map(w => w.top)) - Math.min(...b.map(w => w.top)));
    
    let lineMetrics = lines.map(line => ({
        words: line,
        top: Math.min(...line.map(w => w.top)),
        left: Math.min(...line.map(w => w.left)),
        right: Math.max(...line.map(w => w.left + w.width)),
        wordCount: line.length
    }));
    
    const bodyLines = lineMetrics.filter(l => l.wordCount > 2);
    const referenceLines = bodyLines.length ? bodyLines : lineMetrics;
    const lefts = referenceLines.map(l => l.left).sort((a, b) => a - b);
    const stdLeftMargin = lefts[Math.floor(lefts.length / 2)] || 0;
    const rights = referenceLines.map(l => l.right).sort((a, b) => a - b);
    const stdRightMargin = rights[Math.floor(rights.length * 0.9)] || 0;
    
    let paragraphs = [];
    let currPara = [];
    for (let i = 0; i < lineMetrics.length; i++) {
        const line = lineMetrics[i];
        currPara.push(...line.words);
        let forceBreak = false;
        if (i < lineMetrics.length - 1) {
            const nextLine = lineMetrics[i + 1];
            const topDiff = nextLine.top - line.top;
            const indentX = nextLine.left - stdLeftMargin;
            const shortfall = stdRightMargin - line.right;
            if (topDiff > medH * 1.5) forceBreak = true;
            else if (indentX > medH * 1.5) forceBreak = true;
            else if (shortfall > medH * 1.5) forceBreak = true;
        }
        if (i === lineMetrics.length - 1 || forceBreak) {
            paragraphs.push(currPara);
            currPara = [];
        }
    }
    return { paragraphs, medH };
  }
  
  window.loadDigitalPage = async function(bookId, fileName) {
    rmLoading.style.display = 'block';
    rmError.style.display = 'none';
    rmReadContainer.style.display = 'none';
    exitEditMode();
    
    if(modalHighlightOverlay) modalHighlightOverlay.textContent = '';
    rmReadContainer.innerHTML = '';
    currentDigitalData = null;
    
    const match = fileName.match(/\d+/);
    if(!match) return showErrorState();
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/page/${encodeURIComponent(bookId)}/${encodeURIComponent(match[0])}`);
      if(!res.ok) return showErrorState();
      const data = await res.json();
      if (!data || data.length === 0) return showErrorState();
      currentDigitalData = data;
      rmLoading.style.display = 'none';
      
      activateReadMode();
      
      if(modalImage.complete) drawHL(modalImage, currentDigitalData, modalHighlightOverlay);
      else modalImage.onload = () => drawHL(modalImage, currentDigitalData, modalHighlightOverlay);
    } catch(e) {
      showErrorState();
    }
  }
  
  function showErrorState() {
    rmLoading.style.display = 'none';
    rmError.textContent = "Page text not available for this page.";
    rmError.style.display = 'block';
  }
  
  function renderFormattedDocument(container, paragraphs, medH) {
    container.innerHTML = '';
    const docWrapper = document.createElement('div');
    docWrapper.style.fontFamily = "'Playfair Display', serif";
    docWrapper.style.fontSize = '1.1rem';
    docWrapper.style.lineHeight = '1.7';
    docWrapper.style.color = 'var(--ink-2)';
    docWrapper.style.textAlign = 'left';
    
    const flat = [];
    paragraphs.forEach((para, pIdx) => {
        para.forEach((line, lIdx) => {
            const words = line.word.trim().split(/\s+/);
            words.forEach((word, wIdx) => { flat.push({ pIdx, lIdx, wIdx, word: word }); });
        });
    });
    
    const cleanToken = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const highlighted = new Set();
    const query = (currentSearchQuery || '').trim();
    
    if (query) {
        const qWords = query.split(/\s+/).map(cleanToken).filter(Boolean);
        if (qWords.length === 1) {
            const q = qWords[0];
            flat.forEach((entry, idx) => {
                if (q && cleanToken(entry.word).includes(q)) highlighted.add(idx);
            });
        } else if (qWords.length > 1) {
            const MAX_ARTIFACT_SKIP = 3;
            for (let start = 0; start < flat.length; start++) {
                if (!cleanToken(flat[start].word).includes(qWords[0])) continue;
                let qi = 1;
                let lastMatchIdx = start;
                let cursor = start + 1;
                while (qi < qWords.length && cursor < flat.length) {
                    const tokenClean = cleanToken(flat[cursor].word);
                    if (!tokenClean && cursor - lastMatchIdx <= MAX_ARTIFACT_SKIP) {
                        cursor++; continue;
                    }
                    if (tokenClean.includes(qWords[qi]) || qWords[qi].includes(tokenClean)) {
                        lastMatchIdx = cursor; qi++; cursor++;
                    } else if (cursor - lastMatchIdx <= MAX_ARTIFACT_SKIP) {
                        cursor++; 
                    } else break;
                }
                if (qi >= qWords.length) {
                    for (let k = start; k <= lastMatchIdx; k++) highlighted.add(k);
                    start = lastMatchIdx; 
                }
            }
        }
    }
    
    let flatCursor = 0;
    paragraphs.forEach(para => {
        const pEl = document.createElement('p');
        pEl.style.marginBottom = '1.2rem';
        para.forEach((line, lIdx) => {
            const words = line.word.trim().split(/\s+/);
            words.forEach((w, wIdx) => {
                const isHighlighted = highlighted.has(flatCursor);
                const span = document.createElement('span');
                span.textContent = w;
                if (isHighlighted) span.className = 'highlight-word';
                pEl.appendChild(span);
                if (wIdx < words.length - 1) pEl.appendChild(document.createTextNode(' '));
                flatCursor++;
            });
            if (lIdx < para.length - 1) pEl.appendChild(document.createTextNode(' '));
        });
        docWrapper.appendChild(pEl);
    });
    container.appendChild(docWrapper);
  }
  
  function activateReadMode() {
    rmReadContainer.style.display = 'block';
    const rmBody = document.querySelector('.rm-body');
    if (rmBody) rmBody.style.alignItems = 'stretch';
    rmRightContent.style.cssText = 'flex: 1; padding: 2rem; overflow-y: auto; overflow-x: auto; height: 100%; display: block;';    rmReadContainer.style.cssText = 'display: block; width: 100%; max-width: 680px; margin: 0 auto; padding-bottom: 4rem;';
    if (!currentDigitalData) return;
    if (currentDigitalData.length === 1 && currentDigitalData[0].left === 0) {
        rmReadContainer.innerHTML = currentDigitalData[0].word;
        
        // FIX: Force the Digital Reader to become an identical padded clone of the Edit Box!
        rmReadContainer.className = "rm-edit-container";
        
        // Wipe out conflicting inline styles and ensure it stays visible
        rmReadContainer.style.cssText = "display: block; white-space: normal;";
    } else {
        const { paragraphs, medH } = parseOCRData(currentDigitalData);
        renderFormattedDocument(rmReadContainer, paragraphs, medH);
    }
    rmRightContent.scrollTop = 0;
  }
  
  btnCopyText.addEventListener('click', async () => {
    if (!currentDigitalData || currentDigitalData.length === 0) {
      showCopyMsg("No text to copy."); return;
    }
    let fullText = "";
    if (currentDigitalData.length === 1 && currentDigitalData[0].left === 0) {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = currentDigitalData[0].word;
        fullText = tempDiv.textContent || tempDiv.innerText || "";
    } else {
        const { paragraphs } = parseOCRData(currentDigitalData);
        fullText = paragraphs.map(para => para.map(line => line.word).join(' ')).join('\n\n');
    }
    try {
      if (typeof navigator.clipboard === 'undefined') throw new Error();
      await navigator.clipboard.writeText(fullText);
      showCopyMsg("Copied!");
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = fullText;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showCopyMsg("Copied!"); }
      catch (e) { showCopyMsg("Copy failed."); }
      document.body.removeChild(ta);
    }
  });
  
  function showCopyMsg(msg) {
    copyMsg.textContent = msg;
    copyMsg.style.display = 'inline-block';
    setTimeout(() => copyMsg.style.display = 'none', 1500);
  }

  function enterEditMode() {
    if (!currentDigitalData || currentDigitalData.length === 0) return;
    btnReadMode.style.display = 'none';
    btnCopyText.style.display = 'none';
    btnSuggestEdit.style.display = 'none';
    btnCancelEdit.style.display = 'block';
    btnSubmitEdit.style.display = 'block';
    rmReadContainer.style.display = 'none';
    rmEditContainer.style.display = 'block';
    rmEditContainer.setAttribute('contenteditable', 'true');
    if (currentDigitalData.length === 1 && currentDigitalData[0].left === 0) {
        rmEditContainer.innerHTML = currentDigitalData[0].word;
    } else {
        const { paragraphs } = parseOCRData(currentDigitalData);
        const fullText = paragraphs.map(para => para.map(line => line.word).join(' ')).join('\n\n');
        rmEditContainer.innerHTML = fullText.split('\n\n').map(p => `<p style="margin-bottom: 1.2rem;">${p}</p>`).join('');
    }
    rmEditContainer.focus();
  }
  
  function exitEditMode() {
    btnReadMode.style.display = 'block';
    btnCopyText.style.display = 'block';
    btnSuggestEdit.style.display = 'block';
    btnCancelEdit.style.display = 'none';
    btnSubmitEdit.style.display = 'none';
    rmEditContainer.style.display = 'none';
    rmEditContainer.setAttribute('contenteditable', 'false');
    rmEditContainer.innerHTML = '';
    activateReadMode();
  }
  
  btnSuggestEdit.addEventListener('click', enterEditMode);
  btnCancelEdit.addEventListener('click', exitEditMode);
  
  btnSubmitEdit.addEventListener('click', async () => {
    btnSubmitEdit.disabled = true;
    btnSubmitEdit.textContent = "Submitting...";
    const activeImageUrl = document.getElementById('modalImage').src;
    const pageMatch = activeImageUrl.match(/page_(\d+)/);
    const pageNumStr = pageMatch ? pageMatch[1] : plStatus.textContent.toLowerCase().replace('page ', '').replace('.jpg', '');
    const bookId = metaBookTitle.textContent;
    const richHTML = rmEditContainer.innerHTML;
    
    const payload = { book_id: bookId, page_number: pageNumStr, suggested_text: richHTML };
    try {
        const res = await fetch(API_BASE_URL + '/api/edits/suggest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            window.showCustomAlert('Thank you! Your correction has been submitted for admin review.');
            exitEditMode();
        } else window.showCustomAlert('Failed to submit edit.');
    } catch (err) {
        window.showCustomAlert('Network error. Failed to connect to server.');
    } finally {
        btnSubmitEdit.disabled = false;
        btnSubmitEdit.textContent = 'Submit Edit';
    }
  });

  const adminLoginModal = document.getElementById('adminLoginModal');
  const adminPanel = document.getElementById('adminPanel');
  const closeAdminLoginBtn = document.getElementById('closeAdminLoginBtn');
  const closeAdminPanelBtn = document.getElementById('closeAdminPanelBtn');
  const adminUsername = document.getElementById('adminUsername');
  const adminPassword = document.getElementById('adminPassword');
  const doLoginBtn = document.getElementById('doLoginBtn');
  const adminLoginError = document.getElementById('adminLoginError');
  const tempSignOutBtn = document.getElementById('tempSignOutBtn');
  const openAdminBtn = document.getElementById('openAdminBtn');
  const btnChangeCreds = document.getElementById('btnChangeCreds');
  const adminCredsModal = document.getElementById('adminCredsModal');
  const closeAdminCredsBtn = document.getElementById('closeAdminCredsBtn');
  const newAdminUsername = document.getElementById('newAdminUsername');
  const newAdminPassword = document.getElementById('newAdminPassword');
  const doUpdateCredsBtn = document.getElementById('doUpdateCredsBtn');
  const adminCredsMessage = document.getElementById('adminCredsMessage');

  const pdfBookId = document.getElementById('pdfBookId');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const btnUploadPdf = document.getElementById('btnUploadPdf');
  const btnCancelPdf = document.getElementById('btnCancelPdf');
  const pdfTracker = document.getElementById('pdfTracker');
  const pdfStatusMsg = document.getElementById('pdfStatusMsg');
  const pdfStatusPct = document.getElementById('pdfStatusPct');
  const pdfProgressBar = document.getElementById('pdfProgressBar');
  let pdfStatusInterval = null;

  const navReviewEdits = document.getElementById('navReviewEdits');
  const navManageCatalog = document.getElementById('navManageCatalog');
  const adminReviewSection = document.getElementById('adminReviewSection');
  const adminManageSection = document.getElementById('adminManageSection');
  
  navReviewEdits.addEventListener('click', () => {
      sessionStorage.setItem('adminTab', 'review');
      navReviewEdits.classList.add('active');
      navManageCatalog.classList.remove('active');
      adminReviewSection.style.display = 'flex';
      adminManageSection.style.display = 'none';
  });
  navManageCatalog.addEventListener('click', () => {
      sessionStorage.setItem('adminTab', 'catalog');
      navManageCatalog.classList.add('active');
      navReviewEdits.classList.remove('active');
      adminManageSection.style.display = 'flex';
      adminReviewSection.style.display = 'none';
  });

  const adminQueueList = document.getElementById('adminQueueList');
  const adminToolbar = document.getElementById('adminToolbar');
  const adminPlaceholderText = document.getElementById('adminPlaceholderText');
  const adminViewImage = document.getElementById('adminViewImage');
  const adminViewOld = document.getElementById('adminViewOld');
  const adminViewNew = document.getElementById('adminViewNew');
  
  const tabViewImage = document.getElementById('tabViewImage');
  const tabViewOld = document.getElementById('tabViewOld');
  const tabViewNew = document.getElementById('tabViewNew');
  
  const btnApproveEdit = document.getElementById('btnApproveEdit');
  const btnRejectEdit = document.getElementById('btnRejectEdit');
  
  let activeEditData = null;
  closeAdminLoginBtn.addEventListener('click', () => adminLoginModal.classList.remove('open'));
  closeAdminPanelBtn.addEventListener('click', () => {
      sessionStorage.setItem('adminOpen', 'false');
      adminPanel.classList.remove('open');
  });
  tempSignOutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('adminToken');
    sessionStorage.setItem('adminOpen', 'false');
    adminPanel.classList.remove('open');
  });
  
  openAdminBtn.addEventListener('click', openAdminPanel);
  btnChangeCreds.addEventListener('click', () => {
      adminCredsModal.classList.add('open');
      newAdminUsername.value = '';
      newAdminPassword.value = '';
      adminCredsMessage.style.display = 'none';
  });
  closeAdminCredsBtn.addEventListener('click', () => adminCredsModal.classList.remove('open'));
  doUpdateCredsBtn.addEventListener('click', async () => {
      const newUsername = newAdminUsername.value.trim();
      const newPassword = newAdminPassword.value;
      if (!newUsername || !newPassword) {
          adminCredsMessage.textContent = "Both fields are required.";
          adminCredsMessage.style.color = "#ff6b6b";
          adminCredsMessage.style.display = 'block';
          return;
      }
      doUpdateCredsBtn.disabled = true;
      doUpdateCredsBtn.textContent = 'Updating...';
      const token = sessionStorage.getItem('adminToken');
      
      try {
          const res = await fetch(API_BASE_URL + '/admin/credentials/update', {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ new_username: newUsername, new_password: newPassword })
          });
          const data = await res.json();
          if (res.ok) {
              adminCredsMessage.textContent = "Credentials updated! Please log in again.";
              adminCredsMessage.style.color = "#5fdd9d";
              adminCredsMessage.style.display = 'block';
              setTimeout(() => {
                  adminCredsModal.classList.remove('open');
                  sessionStorage.removeItem('adminToken');
                  adminPanel.classList.remove('open');
                  adminLoginModal.classList.add('open');
              }, 2000);
          } else {
              throw new Error(data.detail || 'Update failed');
          }
      } catch (err) {
          adminCredsMessage.textContent = err.message;
          adminCredsMessage.style.color = "#ff6b6b";
          adminCredsMessage.style.display = 'block';
      } finally {
          doUpdateCredsBtn.disabled = false;
          doUpdateCredsBtn.textContent = 'Update';
      }
  });

  function resetUploadUI() {
      sessionStorage.removeItem('activeUploadTitle'); // NEW: Clears memory when done
      btnUploadPdf.disabled = false;
      btnUploadPdf.textContent = 'Upload & Index';
      btnCancelPdf.style.display = 'none';
      btnCancelPdf.textContent = 'Cancel';
      btnCancelPdf.disabled = false;
      pdfBookId.value = '';
      pdfFileInput.value = '';
      setTimeout(() => { pdfTracker.style.display = 'none'; }, 5000);
  }

  btnUploadPdf.addEventListener('click', async () => {
    const bookId = pdfBookId.value.trim();
    const file = pdfFileInput.files[0];
    if (!bookId || !file) { window.showCustomAlert("Please enter a Book Title/ID and select a PDF file."); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { window.showCustomAlert("Selected file must be a PDF."); return; }
    const token = sessionStorage.getItem('adminToken');
    if (!token) { window.showCustomAlert("Admin session expired. Please log in again."); return; }
    
    const formData = new FormData();
    formData.append('book_id', bookId);
    formData.append('file', file);
    
    sessionStorage.setItem('activeUploadTitle', bookId); // NEW: Saves title to memory

    btnUploadPdf.disabled = true;
    btnUploadPdf.textContent = 'Processing...';
    btnCancelPdf.style.display = 'block';
    pdfTracker.style.display = 'flex';
    pdfStatusMsg.textContent = "Uploading securely to server...";
    pdfStatusMsg.style.color = "var(--gold)";
    pdfStatusPct.textContent = "0%";
    pdfProgressBar.style.width = "0%";
    pdfProgressBar.style.background = "linear-gradient(90deg, var(--gold-2), var(--gold-3))";
    
    try {
      const res = await fetch(API_BASE_URL + '/admin/upload-pdf', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (res.ok) {
        startPdfStatusPolling();
      } else {
        const data = await res.json();
        throw new Error(data.detail || data.message || 'Upload failed');
      }
    } catch (err) {
      pdfStatusMsg.textContent = err.message;
      pdfStatusMsg.style.color = '#ff6b6b';
      resetUploadUI();
    }
  });
  async function checkActiveUpload() {
      const token = sessionStorage.getItem('adminToken');
      if (!token) return;
      try {
          const res = await fetch(API_BASE_URL + '/admin/upload-pdf/status', {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
              const data = await res.json();
              if (data.running) {
                  // NEW: Restore the title from memory and put it in the box
                  const savedTitle = sessionStorage.getItem('activeUploadTitle');
                  if (savedTitle) {
                      pdfBookId.value = savedTitle;
                  }

                  // Re-engage the UI and progress bar
                  btnUploadPdf.disabled = true;
                  btnUploadPdf.textContent = 'Processing...';
                  btnCancelPdf.style.display = 'block';
                  pdfTracker.style.display = 'flex';
                  pdfStatusMsg.style.color = "var(--gold)";
                  pdfStatusMsg.textContent = data.message;
                  pdfStatusPct.textContent = `${data.progress}%`;
                  pdfProgressBar.style.width = `${data.progress}%`;
                  pdfProgressBar.style.background = "linear-gradient(90deg, var(--gold-2), var(--gold-3))";
                  
                  // Restart the polling loop
                  startPdfStatusPolling();
              }
          }
      } catch (e) {}
  }
  function startPdfStatusPolling() {
    if (pdfStatusInterval) clearInterval(pdfStatusInterval);
    
    pdfStatusInterval = setInterval(async () => {
      const token = sessionStorage.getItem('adminToken');
      if (!token) { clearInterval(pdfStatusInterval); return; }
      try {
        const res = await fetch(API_BASE_URL + '/admin/upload-pdf/status', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const statusData = await res.json();
          pdfStatusMsg.textContent = statusData.message;
          pdfStatusPct.textContent = `${statusData.progress}%`;
          pdfProgressBar.style.width = `${statusData.progress}%`;
          
          if (!statusData.running) {
            clearInterval(pdfStatusInterval);
            if (statusData.message.includes('successfully') || statusData.progress === 100) {
                pdfProgressBar.style.width = "100%";
                pdfStatusPct.textContent = "100%";
                pdfStatusMsg.style.color = "#5fdd9d";
                pdfProgressBar.style.background = "#5fdd9d";
                resetUploadUI();
                // FIX: Instantly refresh the admin catalog without requiring a logout!
                loadAdminBooks(); 
            } else if (statusData.message.includes('cancelled')) {
                pdfStatusMsg.style.color = "#ff6b6b";
                pdfProgressBar.style.background = "#ff6b6b";
                resetUploadUI();
                loadAdminBooks();
            } else {
                pdfStatusMsg.style.color = "#ff6b6b";
                resetUploadUI();
            }
          }
        }
      } catch (e) { }
    }, 1500);
  }

  btnCancelPdf.addEventListener('click', async () => {
    const token = sessionStorage.getItem('adminToken');
    if (!token) return;
    btnCancelPdf.textContent = 'Killing process...';
    btnCancelPdf.disabled = true;
    pdfStatusMsg.textContent = "Sending termination signal...";
    try {
      await fetch(API_BASE_URL + '/admin/upload-pdf/cancel', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (err) {
      btnCancelPdf.textContent = 'Cancel';
      btnCancelPdf.disabled = false;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault(); openAdminPanel();
    }
  });
  
  function openAdminPanel() {
    const token = sessionStorage.getItem('adminToken');
    if (token) {
        sessionStorage.setItem('adminOpen', 'true');
        
        // THIS IS THE MISSING LINE THAT MAKES IT VISIBLE:
        adminPanel.classList.add('open'); 
        
        if (sessionStorage.getItem('adminTab') === 'catalog') {
            navManageCatalog.click();
        } else {
            navReviewEdits.click();
        }
        
        loadAdminBooks();
        loadPendingEdits();
        checkActiveUpload();
    } else { 
        adminLoginModal.classList.add('open'); 
        adminUsername.focus(); 
    }
  }
  
  doLoginBtn.addEventListener('click', loginAdmin);
  adminPassword.addEventListener('keypress', e => { if(e.key === 'Enter') loginAdmin(); });
  
  async function loginAdmin() {
    const username = adminUsername.value.trim();
    const password = adminPassword.value;
    if (!username || !password) return;
    doLoginBtn.textContent = 'Authenticating...';
    doLoginBtn.disabled = true;
    adminLoginError.style.display = 'none';
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    try {
      const res = await fetch(API_BASE_URL + '/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Login failed');
      sessionStorage.setItem('adminToken', data.access_token);
      adminLoginModal.classList.remove('open');
      adminUsername.value = ''; adminPassword.value = '';
      adminPanel.classList.add('open');
      loadPendingEdits();
      loadAdminBooks();
    } catch (err) {
      adminLoginError.textContent = err.message;
      adminLoginError.style.display = 'block';
    } finally {
      doLoginBtn.textContent = 'Login'; doLoginBtn.disabled = false;
    }
  }
  function handleSessionExpired() {
    sessionStorage.removeItem('adminToken');
    adminPanel.classList.remove('open');
    adminLoginModal.classList.add('open');
    adminLoginError.textContent = 'Security session expired. Please log in again.';
    adminLoginError.style.display = 'block';
}
  async function loadPendingEdits() {
      const token = sessionStorage.getItem('adminToken');
      if(!token) return;
      adminQueueList.innerHTML = '<div style="color:white; padding:1rem; font-size:0.8rem;">Loading queue...</div>';
      try {
          const res = await fetch(API_BASE_URL + '/admin/edits/pending', {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.status === 401) return handleSessionExpired();
          if (!res.ok) throw new Error("Failed to fetch");
          const edits = await res.json();
          adminQueueList.innerHTML = '';
          if (edits.length === 0) {
              adminQueueList.innerHTML = '<div style="color: rgba(255,255,255,0.4); padding:1rem; font-size:0.8rem; text-align:center;">No pending edits.</div>';
              return;
          }
          edits.forEach(edit => {
              const div = document.createElement('div');
              div.className = 'admin-queue-item';
              const formattedDate = new Date(edit.timestamp).toLocaleString();
              div.innerHTML = `
                  <div class="aq-title">Page ${edit.page_number}</div>
                  <div class="aq-sub">${edit.book_id.replace(/_/g, ' ')}</div>
                  <div class="aq-sub" style="margin-top: 4px; color:var(--gold)">${formattedDate}</div>
              `;
              div.onclick = () => selectEdit(edit, div);
              adminQueueList.appendChild(div);
          });
      } catch (err) {
          adminQueueList.innerHTML = '<div style="color: #ff6b6b; padding:1rem; font-size:0.8rem;">Error loading queue.</div>';
      }
  }
  
  async function selectEdit(edit, uiElement) {
      activeEditData = edit;
      document.querySelectorAll('.admin-queue-item').forEach(el => el.classList.remove('active'));
      if(uiElement) uiElement.classList.add('active');
      adminToolbar.style.opacity = '1';
      adminToolbar.style.pointerEvents = 'auto';
      adminPlaceholderText.style.display = 'none';
      const imgPath = encodeURI(`/images/${edit.book_id}/page_${edit.page_number}.jpg`);
      adminViewImage.src = `${API_BASE_URL}${imgPath}`;
      adminViewOld.innerHTML = '<div style="font-style:italic;">Loading current text...</div>';
      
      try {
          const res = await fetch(`${API_BASE_URL}/api/page/${edit.book_id}/${edit.page_number}`);
          if(res.ok) {
              const oldData = await res.json();
              
              // NEW FIX: Check if it is pre-formatted HTML (left === 0)
              if (oldData && oldData.length === 1 && oldData[0].left === 0) {
                  adminViewOld.innerHTML = oldData[0].word;
                  
                  // Make it look perfectly identical to the Edit box
                  adminViewOld.className = "rm-edit-container";
                  adminViewOld.style.whiteSpace = "normal";
                  adminViewOld.style.fontFamily = "";
                  adminViewOld.style.fontSize = "";
                  adminViewOld.style.lineHeight = "";
                  adminViewOld.style.color = "";
                  adminViewOld.style.textAlign = "";
                  adminViewOld.style.padding = "1.5rem";
                  adminViewOld.style.boxSizing = "border-box";
              } else {
                  // OLD BEHAVIOR: If it's raw OCR, parse it normally
                  const { paragraphs, medH } = parseOCRData(oldData);
                  renderFormattedDocument(adminViewOld, paragraphs, medH, true);
              }
          } else {
              adminViewOld.innerHTML = '<div style="color:var(--crimson);">Error fetching current OCR.</div>';
          }
      } catch(e) {
          adminViewOld.innerHTML = '<div style="color:var(--crimson);">Network error fetching OCR.</div>';
      }
      
      // --- XSS SANITIZER: Clean malicious code before rendering ---
      // --- LIGHTWEIGHT XSS SANITIZER (Non-Destructive) ---
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = edit.suggested_text;
      
      const scripts = tempDiv.querySelectorAll('script');
      scripts.forEach(s => s.remove());
      
      const allNodes = tempDiv.querySelectorAll('*');
      allNodes.forEach(node => {
          for (let attr of [...node.attributes]) {
              if (attr.name.startsWith('on')) {
                  node.removeAttribute(attr.name);
              }
          }
      });
      
      // Render exactly as the original code did
      adminViewNew.innerHTML = tempDiv.innerHTML; 
      
      // FIX 1: Force Admin Box to become an identical white padded clone of the Edit Box
      adminViewNew.className = "rm-edit-container";
      
      // Force normal HTML wrapping to perfectly match the Edit Box
      adminViewNew.style.whiteSpace = "normal";
      adminViewNew.style.fontFamily = "";
      adminViewNew.style.fontSize = "";
      adminViewNew.style.lineHeight = "";
      adminViewNew.style.color = "";
      adminViewNew.style.textAlign = "";
      adminViewNew.style.padding = "1.5rem";
      adminViewNew.style.boxSizing = "border-box";
      
      switchAdminTab('new');
  }
  
  function switchAdminTab(target) {
      tabViewImage.classList.remove('active');
      tabViewOld.classList.remove('active');
      tabViewNew.classList.remove('active');
      adminViewImage.style.display = 'none';
      adminViewOld.style.display = 'none';
      adminViewNew.style.display = 'none';
      
      if (target === 'image') {
          tabViewImage.classList.add('active');
          adminViewImage.style.display = 'block';
      } else if (target === 'old') {
          tabViewOld.classList.add('active');
          adminViewOld.style.display = 'block';
      } else if (target === 'new') {
          tabViewNew.classList.add('active');
          adminViewNew.style.display = 'block';
      }
  }
  
  tabViewImage.addEventListener('click', () => switchAdminTab('image'));
  tabViewOld.addEventListener('click', () => switchAdminTab('old'));
  tabViewNew.addEventListener('click', () => switchAdminTab('new'));
  
  async function executeResolution(action) {
      if(!activeEditData) return;
      const token = sessionStorage.getItem('adminToken');
      btnApproveEdit.disabled = true;
      btnRejectEdit.disabled = true;
      
      try {
          const res = await fetch(API_BASE_URL + '/admin/edits/resolve', {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ edit_id: activeEditData.id, action: action })
          });
          
          if(res.ok) {
              activeEditData = null;
              adminToolbar.style.opacity = '0.5';
              adminToolbar.style.pointerEvents = 'none';
              adminPlaceholderText.style.display = 'block';
              adminViewImage.style.display = 'none';
              adminViewOld.style.display = 'none';
              adminViewNew.style.display = 'none';
              
              loadPendingEdits();
              // FIX: Refresh catalog in case the approval created a new database entry!
              if (action === 'approve') loadAdminBooks();
          } else {
              window.showCustomAlert('Error resolving edit.');
          }
      } catch(err) {
          window.showCustomAlert('Network error during resolution.');
      } finally {
          btnApproveEdit.disabled = false;
          btnRejectEdit.disabled = false;
      }
  }
  
  btnApproveEdit.addEventListener('click', () => executeResolution('approve'));
  btnRejectEdit.addEventListener('click', () => executeResolution('reject'));
  
  const adminBookList = document.getElementById('adminBookList');
  const btnDownloadPdf = document.getElementById('btnDownloadPdf');
  
  btnDownloadPdf.addEventListener('click', async () => {
      const selected = Array.from(adminBookList.selectedOptions).map(opt => opt.value);
      if(selected.length === 0 || selected[0].includes('No books') || selected[0].includes('Loading')) {
          window.showCustomAlert('Please select a book to download.');
          return;
      }
      
      const bookId = selected[0]; 
      const token = sessionStorage.getItem('adminToken');
      
      btnDownloadPdf.disabled = true;
      btnDownloadPdf.textContent = 'Generating PDF...';
      
      try {
          const res = await fetch(`${API_BASE_URL}/admin/books/download/${encodeURIComponent(bookId)}`, {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.status === 401) return handleSessionExpired();
          if (!res.ok) throw new Error('Failed to generate PDF');
          
          // Convert the binary stream into a downloadable file
          const blob = await res.blob();
          const downloadUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `${bookId}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(downloadUrl);
          
      } catch(e) {
          window.showCustomAlert('Error downloading PDF: ' + e.message);
      } finally {
          btnDownloadPdf.disabled = false;
          btnDownloadPdf.textContent = 'Download Selected';
      }
  });
  const btnPromptDelete = document.getElementById('btnPromptDelete');
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const btnCancelDeleteModal = document.getElementById('btnCancelDeleteModal');
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');
  const deleteAdminPassword = document.getElementById('deleteAdminPassword');
  const deleteConfirmError = document.getElementById('deleteConfirmError');

  window.loadAdminBooks = async function() {
      const token = sessionStorage.getItem('adminToken');
      if(!token) return;
      adminBookList.innerHTML = '<option disabled>Loading catalog...</option>';
      try {
          const res = await fetch(API_BASE_URL + '/admin/books', {
              headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.status === 401) return handleSessionExpired();
          if(res.ok) {
              const data = await res.json();
              adminBookList.innerHTML = '';
              if(data.books.length === 0) {
                  adminBookList.innerHTML = '<option disabled>No books found in database.</option>';
              } else {
                  data.books.forEach(b => {
                      const opt = document.createElement('option');
                      opt.value = b; opt.textContent = b;
                      adminBookList.appendChild(opt);
                  });
              }
          }
      } catch(e) {
          adminBookList.innerHTML = '<option disabled>Error loading books.</option>';
      }
  }

  btnPromptDelete.addEventListener('click', () => {
      const selected = Array.from(adminBookList.selectedOptions).map(opt => opt.value);
      if(selected.length === 0 || selected[0].includes('No books') || selected[0].includes('Loading')) {
          window.showCustomAlert('Please select at least one book to delete.');
          return;
      }
      deleteAdminPassword.value = '';
      deleteConfirmError.style.display = 'none';
      deleteConfirmModal.classList.add('open');
      setTimeout(() => deleteAdminPassword.focus(), 100);
  });
  
  btnCancelDeleteModal.addEventListener('click', () => { deleteConfirmModal.classList.remove('open'); });
  btnConfirmDelete.addEventListener('click', async () => {
      const pwd = deleteAdminPassword.value;
      if(!pwd) {
          deleteConfirmError.textContent = 'Admin password is required.';
          deleteConfirmError.style.display = 'block';
          return;
      }
      const selected = Array.from(adminBookList.selectedOptions).map(opt => opt.value);
      const token = sessionStorage.getItem('adminToken');
      btnConfirmDelete.disabled = true;
      btnConfirmDelete.textContent = 'Deleting...';
      try {
          const res = await fetch(API_BASE_URL + '/admin/books', {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ books: selected, password: pwd })
          });
          const data = await res.json();
          if(res.ok) {
              deleteConfirmModal.classList.remove('open');
              loadAdminBooks(); 
              window.showCustomAlert(data.message);
          } else {
              throw new Error(data.detail || data.message || 'Deletion failed.');
          }
      } catch(e) {
          deleteConfirmError.textContent = e.message;
          deleteConfirmError.style.display = 'block';
      } finally {
          btnConfirmDelete.disabled = false;
          btnConfirmDelete.textContent = 'Permanently Delete';
      }
  });

  // ==========================================
  // WEBSOCKET: GLOBAL REAL-TIME UPDATES
  // ==========================================
  // This tells the Cloud Frontend exactly where your laptop is
  // (We will replace the 'api.your-tunnel.com' part in the final step!)
  // This automatically strips "https://" to create the WebSocket address
  const BACKEND_URL = API_BASE_URL.replace("https://", ""); 
  const wsUrl = `wss://${BACKEND_URL}/ws/updates`;
  let ws;

  function connectWebSocket() {
      ws = new WebSocket(wsUrl);
      
      ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          
          if (data.event === 'EDIT_APPROVED') {
              // Updates the public reader when an admin approves an edit
              if (readerModal.classList.contains('open') && 
                  currentReaderUrl.includes(data.book_id) && 
                  currentReaderUrl.includes(`page_${data.page_number}.jpg`)) {
                  
                  window.loadDigitalPage(data.book_id, `page_${data.page_number}.jpg`);
              }
          } 
          else if (data.event === 'NEW_EDIT_SUGGESTED') {
              // NEW: Updates the Admin Dashboard instantly when a user submits an edit
              if (adminPanel.classList.contains('open')) {
                  loadPendingEdits();
              }
          }
      };
      
      ws.onclose = () => {
          // Reconnect automatically if the server drops
          setTimeout(connectWebSocket, 5000); 
      };
  }
  
  // Start the connection as soon as the page loads
  connectWebSocket();

  // --- STATE RESTORATION ON REFRESH ---
  const savedQuery = sessionStorage.getItem('searchQuery');
  const savedPage = sessionStorage.getItem('searchPage');
  const savedIdx = parseInt(sessionStorage.getItem('searchPageIdx')) || 0;
  
  if (savedPage && searchPageInput) searchPageInput.value = savedPage;
  
  if (savedQuery || savedPage) {
      if (savedQuery) searchInput.value = savedQuery;
      executeSearch(savedQuery || "", savedIdx);
  }

  const adminOpen = sessionStorage.getItem('adminOpen');
  if (adminOpen === 'true' && sessionStorage.getItem('adminToken')) {
         openAdminPanel();
     }

     const savedReaderUrl = sessionStorage.getItem('readerUrl');
     if (savedReaderUrl) {
         currentReaderUrl = savedReaderUrl;
         openModal(savedReaderUrl);
     }
   });