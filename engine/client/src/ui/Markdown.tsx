import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { getState } from '../store';
import { FileLink, MessageImage } from './MessageFiles';

/** Only navigable web/mail URLs or conversation-scoped local references. Never raw HTML. */
export function markdownUrl(url:string) {
  if (/^file:\/\//i.test(url)) {try{const file=new URL(url);return file.hostname&&file.hostname!=='localhost'?'':file.pathname;}catch{return '';}}
  if (/^(?:https?:|mailto:)/i.test(url) || url.startsWith('#')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) return '';
  return url;
}
function localUrl(url:string, thread?:string) {
  const wid=getState().worldId;
  if(!wid||!thread)return '';
  const root=`/api/worlds/${wid}/threads/${thread}/`;
  if(url.startsWith(root+'attachments/')||url.startsWith(root+'file?path='))return url;
  // Line suffixes are useful in CLI citations, but aren't part of a file name.
  let name=url.split('#')[0].replace(/:\d+(?::\d+)?$/,'');
  try{name=decodeURIComponent(name);}catch{return '';}
  return root+'file?path='+encodeURIComponent(name);
}
const textContent=(node:ReactNode):string=>Children.toArray(node).map(child=>isValidElement<{children?:ReactNode}>(child)?textContent(child.props.children):String(child)).join('');
function CodeBlock({children}:{children?:ReactNode}) {
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  const code=Children.toArray(children).find(isValidElement) as React.ReactElement<{className?:string}>|undefined;
  const language=code?.props.className?.match(/language-([\w+-]+)/)?.[1]??'text';
  return <div className="code-block"><div className="code-toolbar"><span>{language}</span><button onClick={async()=>{try{await navigator.clipboard.writeText(textContent(children).replace(/\n$/,''));setCopied(true);setError('');setTimeout(()=>setCopied(false),1800);}catch{setError('Could not copy');}}}>{error|| (copied?'Copied ✓':'Copy')}</button></div><pre className="code">{children}</pre></div>;
}
export function Markdown({text,thread}:{text:string;thread?:string}) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight,{detect:false}]]} skipHtml urlTransform={markdownUrl} components={{
    a:({href,children})=>{
      if(!href)return <span>{children}</span>;
      if(/^(?:https?:|mailto:|#)/i.test(href))return <a href={href} target={href.startsWith('#')?undefined:'_blank'} rel="noopener noreferrer">{children}</a>;
      const url=localUrl(href,thread);return url?<FileLink url={url} name={href.split('/').at(-1)??'download'}>{children}</FileLink>:<span>{children}</span>;
    },
    img:({src,alt})=>{if(typeof src!=='string'||!src)return <span>{alt}</span>;const url=/^https?:\/\//i.test(src)?src:localUrl(src,thread);return url?<MessageImage src={url} alt={alt??'Image'}/>:<span>{alt}</span>;},
    pre:({children})=><CodeBlock>{children}</CodeBlock>,
    table:({children})=><div className="md-table"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
