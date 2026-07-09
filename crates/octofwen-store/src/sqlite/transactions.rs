use rusqlite::Connection;

use crate::sqlite::connection::StorageResult;

pub fn immediate_transaction<T>(
    connection: &mut Connection,
    operation: impl FnOnce(&rusqlite::Transaction<'_>) -> StorageResult<T>,
) -> StorageResult<T> {
    let transaction = connection.transaction()?;
    let result = operation(&transaction)?;
    transaction.commit()?;
    Ok(result)
}
