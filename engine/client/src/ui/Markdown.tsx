import { Children, isValidElement, useCallback, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Root, RootContent } from 'hast';
import { getState } from '../store';
import { FileLink, MessageImage } from './MessageFiles';
import { codePreviewKind, fileName, previewKind, rawMarkup } from '../previews';
import { HtmlPreview, InlinePreview, PreviewDialog } from './MessagePreview';

/** Only navigable web/mail URLs or conversation-scoped local references. Never raw HTML. */
export function markdownUrl(url:string) {
  if (/^file:\/\//i.test(url)) {try{const file=new URL(url);return file.hostname&&file.hostname!=='localhost'?'':file.pathname;}catch{return '';}}
  if (/^(?:https?:|mailto:)/i.test(url) || url.startsWith('#')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) return '';
  return url;
}
function localUrl(url:string, thread?:string) {
  const wid=getState().vorldId;
  if(!wid||!thread)return '';
  const root=`/api/vorlds/${wid}/threads/${thread}/`;
  if(url.startsWith(root+'attachments/')||url.startsWith(root+'file?path='))return url;
  // Line suffixes are useful in CLI citations, but aren't part of a file name.
  let name=url.split('#')[0].replace(/:\d+(?::\d+)?$/,'');
  try{name=decodeURIComponent(name);}catch{return '';}
  return root+'file?path='+encodeURIComponent(name);
}
const textContent=(node:ReactNode):string=>Children.toArray(node).map(child=>isValidElement<{children?:ReactNode}>(child)?textContent(child.props.children):String(child)).join('');

const proseBlocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'th', 'td']);
const proseContainers = new Set(['ul', 'ol', 'blockquote', 'table']);
function rehypeDirection() {
  return (root: Root) => {
    function visit(node: Root | RootContent, inheritsDirection = false) {
      if (node.type === 'element') {
        if (node.tagName === 'pre') return;
        if (!inheritsDirection && proseBlocks.has(node.tagName)) node.properties.dir = 'auto';
        if (node.tagName === 'code') node.properties.dir = 'ltr';
      }
      if (!('children' in node)) return;
      // Auto direction ignores children with their own dir. Let the first item, paragraph or
      // header cell supply the direction of its list, quote or table.
      const usesFirstBlock = inheritsDirection || (node.type === 'element' && proseContainers.has(node.tagName));
      const first = usesFirstBlock
        ? node.children.find((child) => child.type === 'element' || (child.type === 'text' && child.value.trim()))
        : undefined;
      node.children.forEach((child) => visit(child, child === first));
    }
    visit(root);
  };
}
/** The Clipboard API needs a secure context and a granted permission (the desktop app must allow it; a LAN host on plain http has none); fall back to the selection copy that Cmd+C uses. */
export async function copyText(text:string) {
  try{await navigator.clipboard.writeText(text);return;}catch{/* fall through */}
  const area=document.createElement('textarea'),focused=document.activeElement as HTMLElement|null;
  area.value=text;area.readOnly=true;area.style.cssText='position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(area);area.select();
  try{if(!document.execCommand('copy'))throw new Error('Could not copy');}finally{area.remove();focused?.focus?.();}
}
function CodeBlock({children,thread}:{children?:ReactNode;thread?:string}) {
  const [copied,setCopied]=useState(false),[error,setError]=useState('');
  const [preview,setPreview]=useState(false),[expanded,setExpanded]=useState(false);
  const closeExpanded=useCallback(()=>setExpanded(false),[]);
  const code=Children.toArray(children).find(isValidElement) as React.ReactElement<{className?:string}>|undefined;
  const language=code?.props.className?.match(/language-([\w+-]+)/)?.[1]??'text';
  const source=textContent(children).replace(/\n$/,''),kind=codePreviewKind(language,source);
  return <div className="code-block" dir="ltr"><div className="code-toolbar"><span>{language}</span><span className="code-actions">{kind&&<><button type="button" onClick={()=>setPreview(!preview)} aria-pressed={preview}>{preview?'Source':'Preview'}</button><button type="button" onClick={()=>setExpanded(true)}>Expand preview</button></>}<button type="button" onClick={async()=>{try{await copyText(source);setCopied(true);setError('');setTimeout(()=>setCopied(false),1800);}catch{setError('Could not copy');}}}>{error|| (copied?'Copied ✓':'Copy')}</button></span></div>{preview&&kind?<div className="inline-preview"><InlinePreview kind={kind} source={source} language={language} thread={thread}/></div>:<pre className="code">{children}</pre>}
    {expanded&&<PreviewDialog name={`${language} preview`} onClose={closeExpanded}><InlinePreview kind={kind} source={source} language={language} thread={thread}/></PreviewDialog>}
  </div>;
}
export function Markdown({text,thread}:{text:string;thread?:string}) {
  if(rawMarkup(text))return <HtmlPreview source={text}/>;
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeDirection,[rehypeHighlight,{detect:false}]]} skipHtml urlTransform={markdownUrl} components={{
    a:({href,children})=>{
      if(!href)return <span>{children}</span>;
      if(/^(?:https?:|mailto:|#)/i.test(href))return <a href={href} target={href.startsWith('#')?undefined:'_blank'} rel="noopener noreferrer">{children}</a>;
      const url=localUrl(href,thread);return url?<FileLink url={url} name={fileName(href)}>{children}</FileLink>:<span>{children}</span>;
    },
    img:({src,alt})=>{if(typeof src!=='string'||!src)return <span>{alt}</span>;const url=/^https?:\/\//i.test(src)?src:localUrl(src,thread);return url?<MessageImage src={url} alt={alt??'Image'}/>:<span>{alt}</span>;},
    // a link to a picture also shows the picture, under the paragraph it is in (the link itself stays in the sentence)
    p:({children,dir})=>{
      const pictures=Children.toArray(children).flatMap(c=>{const href=isValidElement<{href?:string}>(c)?c.props.href:undefined;return href&&!/^(?:https?:|mailto:|#)/i.test(href)&&['image','svg'].includes(previewKind(fileName(href))??'')?[{href,alt:textContent((c as React.ReactElement<{children?:ReactNode}>).props.children)}]:[];});
      if(!pictures.length)return <p dir={dir}>{children}</p>;
      return <><p dir={dir}>{children}</p>{pictures.map(({href,alt})=>{const url=localUrl(href,thread);return url?<div className="image-link" key={url}><MessageImage src={url} alt={alt||fileName(href)} soft/></div>:null;})}</>;
    },
    pre:({children})=><CodeBlock thread={thread}>{children}</CodeBlock>,
    table:({children,dir})=><div className="md-table"><table dir={dir}>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
