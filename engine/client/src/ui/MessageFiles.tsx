import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { allowFile, FileAccessError, fileBlob } from '../api';
import { fileName, previewKind, previewMime } from '../previews';
import { FilePreview } from './MessagePreview';

export type Attachment = {id:string;name:string;type:string;size:number;url:string};
export const fileSize = (n: number) => {const units=['B','KB','MB','GB','TB','PB'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${i?n.toFixed(1):n} ${units[i]}`;};
export async function downloadFile(url:string,name:string) {
  const blob=await fileBlob(url), object=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=object;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);
}
export function FileLink({url,name,children}:{url:string;name:string;children?:ReactNode}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const close = useCallback(() => setOpen(false), []);
  const download = async () => {if(busy)return;setBusy(true);setError('');try{await downloadFile(url,name);}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  return <span className="file-link"><a href={url} title={previewKind(name)?'Preview file':'Download file'} onClick={e=>{e.preventDefault();if(previewKind(name))setOpen(true);else void download();}}>{children??name}{busy?' …':''}</a>{error&&<small role="alert">{error}</small>}
    {open&&<FilePreview url={url} name={name} onClose={close} download={<button type="button" className="btn small" disabled={busy} onClick={()=>void download()}>{busy?'Downloading…':'Download'}</button>}/>}
  </span>;
}
/** The file lies outside this chat's folders: one click lets the crew read just that file until the game closes. */
export function OutsideFile({url,path,onAllowed}:{url:string;path:string;onAllowed:()=>void}) {
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState('');
  const allow=async()=>{setBusy(true);setProblem('');try{await allowFile(url);onAllowed();}catch(e:any){setProblem(e.message);}finally{setBusy(false);}};
  return <span className="file-outside" role="group" aria-label="This file is outside the chat's folders">
    <span>This file is outside the folders this chat can open.</span><code title={path}>{path}</code>
    <span className="file-outside-actions"><button type="button" className="btn small primary" disabled={busy} onClick={()=>void allow()}>{busy?'Allowing…':'Allow this file for this session'}</button><small>Just this file, until the game closes.</small></span>
    {problem&&<small role="alert">{problem}</small>}
  </span>;
}
export function MessageImage({src,alt,soft=false}:{src:string;alt:string;soft?:boolean}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[open,setOpen]=useState(false),[outside,setOutside]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    setUrl('');setError('');setOutside('');let object='',live=true;const abort=new AbortController();
    if(src.startsWith('/api/')) fileBlob(src,abort.signal,20*1024*1024).then(blob=>{if(!live)return;const name=fileName(src);if(!blob.type.startsWith('image/')&&!['image','svg'].includes(previewKind(name)??''))throw new Error('This file is not a supported image');object=URL.createObjectURL(blob.type.startsWith('image/')?blob:new Blob([blob],{type:previewMime(name)}));setUrl(object);}).catch(e=>{if(!live)return;if(e instanceof FileAccessError)setOutside(e.path);else setError(e.message);});
    else setUrl(src);
    return ()=>{live=false;abort.abort();if(object)URL.revokeObjectURL(object);};
  },[src,attempt]);
  if(soft&&error&&!outside)return null;   // a link that merely looks like an image stays a plain link
  return <span className="chat-image">
    {outside?<OutsideFile url={src} path={outside} onAllowed={()=>setAttempt(n=>n+1)}/>:error?<span className="file-error" role="status">{alt||'Image'}: {error}</span>:url?<button className="image-preview" title="Enlarge image" onClick={()=>setOpen(true)}><img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setError('Could not load image')} /></button>:<span>Loading image…</span>}
    {open&&<span className="image-viewer" role="dialog" aria-label={alt||'Image preview'} aria-modal="true" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}}} onClick={()=>setOpen(false)}><button autoFocus className="btn image-close" onClick={()=>setOpen(false)}>Close image ✕</button><img src={url} alt={alt} referrerPolicy="no-referrer" /></span>}
  </span>;
}
export function MessageFiles({files}:{files?:Attachment[]}) {
  if(!files?.length)return null;
  return <div className="message-files">{files.map(f=><div className="message-file" key={f.id}>
    {(f.type.startsWith('image/')||['image','svg'].includes(previewKind(f.name)??''))&&<MessageImage src={f.url} alt={f.name}/>}
    <FileLink url={f.url} name={f.name}><bdi>{f.name}</bdi></FileLink><small>{fileSize(f.size)}</small>
  </div>)}</div>;
}
