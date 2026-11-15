import { useEffect, useRef, useState, type ReactNode, type DragEvent } from 'react';
import { api, uploadFile } from '../api';
import { fileSize, type Attachment } from './MessageFiles';

type Pending = {id:string;name:string;size:number;file?:File;preview?:string;uploaded?:Attachment};
export function useChatDraft({wid,thread,working,onEvents}:{wid:string;thread:string;working:boolean;onEvents:(update:any)=>void}) {
  const [text,setText]=useState(''),[files,setFiles]=useState<Pending[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dragging,setDragging]=useState(false);
  const current=useRef<Pending[]>([]), depth=useRef(0), locked=useRef(false), alive=useRef(true);
  const updateFiles=(items:Pending[])=>{current.current=items;setFiles(items);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const f of current.current)if(f.preview)URL.revokeObjectURL(f.preview);};},[]);
  const addFiles=(incoming:FileList|File[])=>{
    if(locked.current)return;
    const added:Pending[]=[];
    for(const file of Array.from(incoming)){
      added.push({id:crypto.randomUUID(),file,name:file.name,size:file.size,preview:/^image\/(png|jpeg|gif|webp)$/.test(file.type)?URL.createObjectURL(file):undefined});
    }
    updateFiles([...current.current,...added]);setError('');
  };
  const remove=(id:string)=>{if(locked.current)return;const f=current.current.find(f=>f.id===id);if(f?.preview)URL.revokeObjectURL(f.preview);updateFiles(current.current.filter(f=>f.id!==id));};
  const send=async(message=text,option=false)=>{
    const value=message.trim();if(working||locked.current||(!value&&!current.current.length))return;
    locked.current=true;setBusy(true);setError('');let optimistic='';
    try{
      const sent:Attachment[]=[];
      for(const item of current.current){
        const attachment=item.uploaded??await uploadFile(wid,thread,item.file!);
        item.uploaded=attachment;sent.push(attachment);
      }
      if(!alive.current)return;
      optimistic=crypto.randomUUID();
      onEvents((events:any[])=>[...events,{type:'founder.message',text:value,attachments:sent,at:new Date().toISOString(),clientId:optimistic}]);
      await api(`/worlds/${wid}/threads/${thread}/messages`,{body:{text:value,option,attachments:sent.map(f=>f.id)}});
      if(!alive.current)return;
      setText('');for(const f of current.current)if(f.preview)URL.revokeObjectURL(f.preview);updateFiles([]);
    }catch(e:any){
      if(optimistic)onEvents((events:any[])=>events.filter(e=>e.clientId!==optimistic));
      if(alive.current)setError(e.message);
    }finally{locked.current=false;if(alive.current)setBusy(false);}
  };
  const isFiles=(e:DragEvent)=>Array.from(e.dataTransfer.types).includes('Files');
  const dropHandlers={
    onDragEnter:(e:DragEvent)=>{if(isFiles(e)){e.preventDefault();depth.current++;setDragging(true);}},
    onDragOver:(e:DragEvent)=>{if(isFiles(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';}},
    onDragLeave:(e:DragEvent)=>{e.preventDefault();if(--depth.current<=0){depth.current=0;setDragging(false);}},
    onDrop:(e:DragEvent)=>{if(isFiles(e)){e.preventDefault();e.stopPropagation();depth.current=0;setDragging(false);addFiles(e.dataTransfer.files);}},
  };
  return {text,setText,files,addFiles,remove,send,busy,error,dragging,dropHandlers};
}
type Draft=ReturnType<typeof useChatDraft>;
export function ChatComposer({draft,placeholder,working,onStop,extra,children}:{draft:Draft;placeholder:string;working:boolean;onStop:()=>void;extra?:ReactNode;children?:ReactNode}) {
  const input=useRef<HTMLInputElement>(null);
  return <div className="composer">
    {draft.files.length>0&&<div className="pending-files" aria-label="Files to send">{draft.files.map(f=><div className="pending-file" key={f.id}>
      {f.preview&&<img src={f.preview} alt={f.name}/>}<span><b>{f.name}</b><small>{fileSize(f.size)}{f.uploaded?' · Ready':''}</small></span><button className="x" disabled={draft.busy} aria-label={`Remove ${f.name}`} onClick={()=>draft.remove(f.id)}>✕</button>
    </div>)}</div>}
    {draft.error&&<div className="composer-error" role="alert">{draft.error} Your draft is kept; you can retry.</div>}
    <textarea aria-label={placeholder} value={draft.text} placeholder={placeholder} rows={2} disabled={draft.busy} onChange={e=>draft.setText(e.target.value)} onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();draft.addFiles(e.clipboardData.files);}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void draft.send();}}}/>
    <div className="composer-actions">
      <input ref={input} type="file" multiple hidden onChange={e=>{if(e.target.files)draft.addFiles(e.target.files);e.target.value='';}}/>
      <button className="btn small" title="Attach files" aria-label="Attach files" disabled={draft.busy} onClick={()=>input.current?.click()}>＋ File</button>
      {extra}
      {working?<button className="btn small" onClick={onStop}>Stop</button>:<button className="btn small primary" disabled={draft.busy||(!draft.text.trim()&&!draft.files.length)} onClick={()=>void draft.send()}>{draft.busy?'Sending…':'Send'}</button>}
    </div>
    <div className="composer-hint">Drop or paste files to attach · Shift+Enter for a new line</div>
    {children}
  </div>;
}
export function DropHint(){return <div className="chat-drop-hint">Drop images or files to attach them</div>;}
