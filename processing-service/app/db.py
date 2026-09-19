import os
import psycopg2
from psycopg2.extras import RealDictCursor

def get_db_connection():
    """
    Creates and returns a raw psycopg2 connection to the Postgres database.
    Since we are using raw SQL without an ORM, we return a RealDictCursor
    so that rows can be accessed like dictionaries.
    """
    conn = psycopg2.connect(
        dsn=os.environ["DATABASE_URL"],
        cursor_factory=RealDictCursor
    )
    return conn
