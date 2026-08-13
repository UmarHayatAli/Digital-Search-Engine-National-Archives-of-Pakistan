import sqlite3
import sys

def setup_database():
    db_name = 'archives.db'
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()

    try:
        cursor.execute("CREATE VIRTUAL TABLE temp.fts5_test USING fts5(test_col);")
        cursor.execute("DROP TABLE temp.fts5_test;")
    except sqlite3.OperationalError as e:
        if 'no such module: fts5' in str(e).lower():
            print("ERROR: SQLite does not include FTS5 support.")
            conn.close()
            sys.exit(1)
        else:
            raise

    # Creates the precise 7-column layout expected by PaddleOCR and your frontend
    create_table_sql = """
    CREATE VIRTUAL TABLE IF NOT EXISTS archives USING fts5(
        book_id,
        page_number,
        word,
        left UNINDEXED,
        top UNINDEXED,
        width UNINDEXED,
        height UNINDEXED
    );
    """
    
    cursor.execute(create_table_sql)
    conn.commit()
    conn.close()

    print(f"SUCCESS: '{db_name}' created perfectly with FTS5 support!")

if __name__ == "__main__":
    setup_database()