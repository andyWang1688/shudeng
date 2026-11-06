/** Local text samples in WKWebView; reuse native selection handles and edit menu. */
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type ComponentRef,
} from "react";
import { WebView } from "react-native-webview";
import { StyleSheet } from "react-native";
import { demoColors as c } from "./demoTheme";
import type {
  DemoAnnotation,
  DemoReadingPreferences,
  DemoTextSelection,
  readerSamples,
} from "./readerSamples";

export type DemoSurfaceHandle = { clearSelection: () => void };
type Props = {
  ref?: Ref<DemoSurfaceHandle>;
  samples: ReturnType<typeof readerSamples>;
  preferences: DemoReadingPreferences;
  annotations: DemoAnnotation[];
  focused: boolean;
  initialPosition: number;
  jump: { position: number; revision: number };
  onPosition: (position: number) => void;
  onTap: () => void;
  onSelectionAction: (
    kind: "highlight" | "note",
    selection: DemoTextSelection,
  ) => void;
  onAnnotation: (id: string) => void;
};
const menuItems = [
  { key: "highlight", label: "高亮" },
  { key: "note", label: "写笔记" },
];
export function DemoReadingSurface({ ref, ...props }: Props) {
  const web = useRef<ComponentRef<typeof WebView>>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const send = (message: object) =>
    web.current?.injectJavaScript(
      "window.demoReader && window.demoReader.receive(" +
        JSON.stringify(message) +
        "); true;",
    );
  useImperativeHandle(ref, () => ({
    clearSelection: () => send({ type: "clear" }),
  }));
  useEffect(() => {
    if (ready)
      send({
        type: "update",
        preferences: props.preferences,
        annotations: props.annotations,
        focused: props.focused,
      });
  }, [ready, props.preferences, props.annotations, props.focused]);
  useEffect(() => {
    if (ready) send({ type: "jump", position: props.jump.position });
  }, [ready, props.jump]);
  return (
    <WebView
      ref={web}
      source={source}
      style={styles.web}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
      menuItems={menuItems}
      onCustomMenuSelection={({ nativeEvent }) => {
        web.current?.injectJavaScript(
          "window.demoReader.action(" +
            JSON.stringify(nativeEvent.key) +
            "); true;",
        );
      }}
      onMessage={({ nativeEvent }) => {
        const message = JSON.parse(nativeEvent.data);
        if (message.type === "ready") {
          const current = latest.current;
          send({
            type: "init",
            samples: current.samples,
            preferences: current.preferences,
            annotations: current.annotations,
            focused: current.focused,
            position: current.initialPosition,
          });
          setReady(true);
        } else if (message.type === "position")
          props.onPosition(message.position);
        else if (message.type === "tap") props.onTap();
        else if (message.type === "annotation") props.onAnnotation(message.id);
        else if (message.type === "selection")
          props.onSelectionAction(message.kind, message.selection);
      }}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      scrollEnabled={false}
      bounces={false}
      textInteractionEnabled
    />
  );
}
const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: c.paper },
});

const source = {
  html: String.raw`<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#FAF9F6;color:#292722}
body{font-family:'Songti SC',serif;-webkit-text-size-adjust:100%;--size:20px}
#content{width:100%;height:100%;overflow:auto;overscroll-behavior:contain;scrollbar-width:none}
#content::-webkit-scrollbar{display:none}
#content.scrolled{padding-top:76px;padding-bottom:calc(100vh - 76px)}
article{padding:0 28px;max-width:700px;margin:auto}
h1{font-size:28px;line-height:40px;font-weight:400;margin:16px 0 30px}
p{font-size:var(--size);line-height:1.85;margin:0 0 24px;white-space:pre-wrap;overflow-wrap:anywhere}
.paginated{display:flex;scroll-snap-type:x mandatory}
.paginated article{flex:0 0 100%;width:100%;height:100%;max-width:none;padding:76px 28px 110px;overflow-y:auto;scroll-snap-align:start}
.note{text-decoration:underline wavy #AA7A44;text-underline-offset:5px}
mark{color:inherit;border-radius:2px}
#restore{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);border:0;padding:0}
#restore:focus-visible{clip-path:none;width:auto;height:auto;top:8px;left:8px;padding:12px;z-index:5}
</style></head><body>
<button id="restore" hidden>显示阅读工具栏</button><main id="content" aria-label="阅读正文"></main>
<script>
(function(){
  var root=document.getElementById('content'),restore=document.getElementById('restore');
  var state={samples:[],annotations:[],preferences:{fontSize:20,flow:'paginated'},position:0};
  var remembered=null,lastSelectionAt=0,restoring=false,frame=0;
  function post(data){window.ReactNativeWebView.postMessage(JSON.stringify(data));}
  function selection(){
    var selected=window.getSelection();
    if(!selected||selected.isCollapsed||!selected.rangeCount)return null;
    var range=selected.getRangeAt(0),ranges=[];
    root.querySelectorAll('p').forEach(function(p){
      if(!range.intersectsNode(p))return;
      var start=0,end=p.textContent.length,before=document.createRange();
      before.selectNodeContents(p);
      if(p.contains(range.startContainer)){before.setEnd(range.startContainer,range.startOffset);start=before.toString().length;}
      before.selectNodeContents(p);
      if(p.contains(range.endContainer)){before.setEnd(range.endContainer,range.endOffset);end=before.toString().length;}
      if(end>start)ranges.push({position:Number(p.dataset.position),start:start,end:end});
    });
    if(!ranges.length)return null;
    return {quote:ranges.map(function(r){return state.samples[r.position].text.slice(r.start,r.end);}).join('\n'),ranges:ranges};
  }
  document.addEventListener('selectionchange',function(){var next=selection();if(next){remembered=next;lastSelectionAt=Date.now();}});
  function visiblePosition(){
    if(state.preferences.flow==='paginated')return Math.round(root.scrollLeft/root.clientWidth);
    var result=0;
    root.querySelectorAll('article').forEach(function(node,i){if(node.getBoundingClientRect().top<=77)result=i;});
    return result;
  }
  function jump(position){
    state.position=position;
    var article=root.children[position];if(!article)return;
    restoring=true;
    if(state.preferences.flow==='paginated')root.scrollTo({left:position*root.clientWidth,top:0,behavior:'instant'});
    else root.scrollTo({top:Math.max(0,article.offsetTop-76),left:0,behavior:'instant'});
    requestAnimationFrame(function(){requestAnimationFrame(function(){restoring=false;});});
  }
  function renderText(){
    root.querySelectorAll('p').forEach(function(p,index){
      var text=state.samples[index].text,parts=[0,text.length],marks=[];
      state.annotations.forEach(function(a){a.ranges.forEach(function(r){if(r.position===index){parts.push(r.start,r.end);marks.push({record:a,range:r});}});});
      parts=Array.from(new Set(parts)).sort(function(a,b){return a-b;});p.replaceChildren();
      for(var i=0;i<parts.length-1;i++){
        var start=parts[i],end=parts[i+1],active=marks.find(function(a){return a.range.start<=start&&a.range.end>=end;});
        var node=document.createTextNode(text.slice(start,end));
        if(active){var mark=document.createElement('mark');mark.dataset.mark=active.record.id;
          mark.setAttribute('role','button');mark.tabIndex=0;
          mark.setAttribute('aria-label',(active.record.kind==='note'?'编辑笔记：':'更改高亮：')+active.record.quote);
          if(active.record.kind==='note'){mark.className='note';mark.style.background='transparent';}
          else mark.style.background=active.record.color;
          mark.appendChild(node);p.appendChild(mark);
        }else p.appendChild(node);
      }
    });
  }
  function build(){
    root.replaceChildren();state.samples.forEach(function(item,index){
      var article=document.createElement('article');article.dataset.position=index;
      var heading=document.createElement('h1');heading.textContent=item.chapter;heading.dataset.first=item.paragraphIndex===0?'yes':'no';article.appendChild(heading);
      var p=document.createElement('p');p.dataset.position=index;article.appendChild(p);root.appendChild(article);
    });renderText();
  }
  function update(message){
    var position=state.position,changed=JSON.stringify(state.annotations)!==JSON.stringify(message.annotations);
    var layoutChanged=state.preferences.flow!==message.preferences.flow||state.preferences.fontSize!==message.preferences.fontSize;
    state.preferences=message.preferences;state.annotations=message.annotations;
    root.className=state.preferences.flow;document.body.style.setProperty('--size',state.preferences.fontSize+'px');
    root.querySelectorAll('h1').forEach(function(h){h.hidden=state.preferences.flow==='scrolled'&&h.dataset.first!=='yes';});
    restore.hidden=!message.focused;
    if(changed)renderText();
    if(layoutChanged)jump(position);
  }
  window.demoReader={
    action:function(kind){var chosen=selection()||remembered;if(chosen)post({type:'selection',kind:kind,selection:chosen});window.getSelection().removeAllRanges();remembered=null;},
    receive:function(message){
      if(message.type==='init'){state.samples=message.samples;state.annotations=message.annotations;state.position=message.position;build();update(message);jump(message.position);}
      else if(message.type==='update')update(message);
      else if(message.type==='jump')jump(message.position);
      else if(message.type==='clear'){window.getSelection().removeAllRanges();remembered=null;}
    }
  };
  root.addEventListener('scroll',function(){
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(function(){if(restoring)return;var position=visiblePosition();if(position!==state.position){state.position=position;post({type:'position',position:position});}});
  });
  root.addEventListener('click',function(event){
    if(selection()||Date.now()-lastSelectionAt<400)return;
    var mark=event.target.closest('[data-mark]');
    if(mark)post({type:'annotation',id:mark.dataset.mark});else post({type:'tap'});
  });
  root.addEventListener('keydown',function(event){var mark=event.target.closest('[data-mark]');if(mark&&(event.key==='Enter'||event.key===' ')){event.preventDefault();post({type:'annotation',id:mark.dataset.mark});}});
  restore.addEventListener('click',function(){post({type:'tap'});});
  window.addEventListener('resize',function(){jump(state.position);});
  post({type:'ready'});
})();
</script></body></html>`,
};
