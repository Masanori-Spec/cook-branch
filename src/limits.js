// A source can expand into a larger audit record. Export/import share one record limit.
export const MAX_SOURCE_BYTES=100000;
export const MAX_RECEIPT_BYTES=8*1024*1024;
export function checkTextBytes(text,kind='source'){
  const limit=kind==='receipt'?MAX_RECEIPT_BYTES:MAX_SOURCE_BYTES;
  if(new TextEncoder().encode(text).length>limit){const error=new Error(kind==='receipt'?'The choice record exceeds the 8 MiB supported limit.':'The source exceeds the 100 KB supported limit.');error.code=kind==='receipt'?'RECEIPT_LIMIT':'LIMIT';throw error;}
  return text;
}
export function serializeReceipt(receipt){return checkTextBytes(JSON.stringify(receipt,null,2)+'\n','receipt');}
