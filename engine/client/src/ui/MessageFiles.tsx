import { useEffect, useState, type ReactNode } from 'react';
import { fileBlob } from '../api';

export type Attachment = {id:string;name:string;type:string;size:number;url:string};
export const fileSize = (n: number) => {const units=['B','KB','MB','GB','TB','PB'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${i?n.toFixed(1):n} ${units[i]}`;};
export async function downloadFile(url:string,name:string) {
  const blob=await fileBlob(url), object=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=object;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);
}
export function FileLink({url,name,children}:{url:string;name:string;children?:ReactNode}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <span className="file-link"><a href={url} onClick={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await downloadFile(url,name);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{children??name}{busy?' …':''}</a>{error&&<small role="alert">{error}</small>}</span>;
}
export function MessageImage({src,alt}:{src:string;alt:string}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[open,setOpen]=useState(false);
  useEffect(()=>{
    setUrl('');setError('');let object='',live=true;const abort=new AbortController();
    if(src.startsWith('/api/')) fileBlob(src,abort.signal).then(blob=>{if(!live)return;if(!blob.type.startsWith('image/'))throw new Error('This file is not a supported image');object=URL.createObjectURL(blob);setUrl(object);}).catch(e=>{if(live)setError(e.message);});
    else setUrl(src);
    return ()=>{live=false;abort.abort();if(object)URL.revokeObjectURL(object);};
  },[src]);
  return <span className="chat-image">
    {error?<span className="file-error" role="status">{alt||'Image'}: {error}</span>:url?<button className="image-preview" title="Enlarge image" onClick={()=>setOpen(true)}><img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setError('Could not load image')} /></button>:<span>Loading image…</span>}
    {open&&<span className="image-viewer" role="dialog" aria-label={alt||'Image preview'} aria-modal="true" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}}} onClick={()=>setOpen(false)}><button autoFocus className="btn image-close" onClick={()=>setOpen(false)}>Close image ✕</button><img src={url} alt={alt} referrerPolicy="no-referrer" /></span>}
  </span>;
}
export function MessageFiles({files}:{files?:Attachment[]}) {
  if(!files?.length)return null;
  return <div className="message-files">{files.map(f=><div className="message-file" key={f.id}>
    {f.type.startsWith('image/')&&<MessageImage src={f.url} alt={f.name}/>}
    <FileLink url={f.url} name={f.name}>↓ {f.name}</FileLink><small>{fileSize(f.size)}</small>
  </div>)}</div>;
}
