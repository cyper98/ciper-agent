(function(){
'use strict';
var VS = acquireVsCodeApi();

var vS   = document.getElementById('v-s');
var vC   = document.getElementById('v-c');
var slEl = document.getElementById('sl');
var ct   = document.getElementById('ct');
var mn   = document.getElementById('mn');
var sb   = document.getElementById('sb');
var si   = document.getElementById('si');
var msgs = document.getElementById('msgs');
var imgb = document.getElementById('imgb');
var attb = document.getElementById('attb');
var ci   = document.getElementById('ci');
var sndb = document.getElementById('sndb');
var stpb = document.getElementById('stpb');

var streaming=false, curAi=null, typEl=null, rawBuf='';
var atFiles=[], imgFiles=[], ops=[], curSid='';

function showV(name){
    vS.classList.toggle('active', name==='s');
    vC.classList.toggle('active', name==='c');
}

document.getElementById('back-btn').addEventListener('click',function(){
    showV('s'); VS.postMessage({command:'loadSessions'});
});
document.getElementById('new-s-btn').addEventListener('click',function(){
    VS.postMessage({command:'newSession'});
});

function renderSL(sessions, aSid){
    if(!sessions||!sessions.length){ slEl.innerHTML='<div class="no-s">No chats yet. Click "+ New Chat" to start.</div>'; return; }
    var h='';
    for(var i=0;i<sessions.length;i++){
        var s=sessions[i];
        var isA=s.session===aSid;
        var nm=fmtSid(s.session), dt=fmtDt(s.last_active);
        var pv=s.first_message?esc(s.first_message.slice(0,70))+(s.first_message.length>70?'…':''):'';
        h+='<div class="sc'+(isA?' active':'')+'" data-sid="'+esc(s.session)+'">'
          +'<div class="si"><div class="sn">'+esc(nm)+(isA?' ●':'')+'</div>'
          +'<div class="sm">'+dt+' · '+s.count+' msgs</div>'
          +(pv?'<div class="sp">'+pv+'</div>':'')
          +'</div>'
          +'<button class="sd" data-sid="'+esc(s.session)+'" title="Delete">🗑</button>'
          +'</div>';
    }
    slEl.innerHTML=h;
}
slEl.addEventListener('click',function(e){
    var d=e.target.closest('.sd');
    if(d){e.stopPropagation();VS.postMessage({command:'deleteSession',sessionId:d.dataset.sid});return;}
    var c=e.target.closest('.sc');
    if(c){VS.postMessage({command:'switchSession',sessionId:c.dataset.sid});}
});

document.getElementById('btn-mdl').addEventListener('click',function(){VS.postMessage({command:'switchModel'});});
document.getElementById('btn-exp').addEventListener('click',function(){VS.postMessage({command:'exportChat'});});
document.getElementById('btn-clr').addEventListener('click',function(){VS.postMessage({command:'clearHistory'});});
document.getElementById('btn-srch').addEventListener('click',function(){
    sb.classList.toggle('open');
    if(sb.classList.contains('open')){si.focus();}
});
document.getElementById('sg-btn').addEventListener('click',function(){
    if(si.value.trim()){VS.postMessage({command:'searchHistory'});}
});
document.getElementById('sc-btn').addEventListener('click',function(){sb.classList.remove('open');});
si.addEventListener('keydown',function(e){
    if(e.key==='Enter'){document.getElementById('sg-btn').click();}
    if(e.key==='Escape'){sb.classList.remove('open');}
});

document.addEventListener('paste',function(e){
    if(!vC.classList.contains('active')){return;}
    var items=Array.from((e.clipboardData&&e.clipboardData.items)||[]);
    var hasImg=false;
    items.forEach(function(item){
        if(item.type.startsWith('image/')){
            hasImg=true;
            var file=item.getAsFile();
            if(!file){return;}
            var fr=new FileReader();
            fr.onload=function(ev){imgFiles.push(ev.target.result);renderIB();};
            fr.readAsDataURL(file);
        }
    });
    if(hasImg){e.preventDefault();}
});
function renderIB(){
    if(!imgFiles.length){imgb.classList.remove('open');return;}
    imgb.classList.add('open');
    imgb.innerHTML=imgFiles.map(function(u,i){
        return '<div class="iw" data-i="'+i+'"><img class="it" src="'+u+'"><button class="ir" data-i="'+i+'">✕</button></div>';
    }).join('');
}
imgb.addEventListener('click',function(e){
    var b=e.target.closest('.ir');
    if(b){imgFiles.splice(parseInt(b.dataset.i,10),1);renderIB();}
});

document.getElementById('atb').addEventListener('click',function(){VS.postMessage({command:'attachFile'});});
function renderAB(){
    if(!atFiles.length){attb.classList.remove('open');return;}
    attb.classList.add('open');
    attb.innerHTML=atFiles.map(function(f,i){
        return '<div class="ach">📄 '+esc(f.name)+'<button class="acr" data-i="'+i+'">✕</button></div>';
    }).join('');
}
attb.addEventListener('click',function(e){
    var b=e.target.closest('.acr');
    if(b){atFiles.splice(parseInt(b.dataset.i,10),1);renderAB();}
});

function exOps(raw){
    var res=[], m;
    var r1=/<ciper:write path="([^"]+)">([\s\S]*?)<\/ciper:write>/g;
    var r2=new RegExp('```ciper:write\\s+path="([^"]+)"\\n([\\s\\S]*?)```','g');
    var r3=/<ciper:delete path="([^"]+)"\s*\/>/g;
    while((m=r1.exec(raw))!==null){res.push({a:'w',p:m[1],c:m[2]});}
    while((m=r2.exec(raw))!==null){res.push({a:'w',p:m[1],c:m[2]});}
    while((m=r3.exec(raw))!==null){res.push({a:'d',p:m[1],c:''});}
    return res;
}
function exReads(raw){
    var res=[],m,r=/<ciper:read path="([^"]+)"\s*\/>/g;
    while((m=r.exec(raw))!==null){res.push(m[1]);}
    return res;
}
function stripTags(raw){
    return raw
        .replace(/<ciper:write path="[^"]+">([\s\S]*?)<\/ciper:write>/g,'')
        .replace(new RegExp('```ciper:write\\s+path="[^"]+"\\n[\\s\\S]*?```','g'),'')
        .replace(/<ciper:delete path="[^"]+"\s*\/>/g,'')
        .replace(/<ciper:read path="[^"]+"\s*\/>/g,'');
}
function mkOpCard(op,idx){
    var sp=esc(op.p);
    if(op.a==='w'){
        var snip=esc(op.c.length>800?op.c.slice(0,800)+'\n…':op.c);
        return '<div class="foc" data-oi="'+idx+'"><div class="foh"><span>📝</span><span class="fop">'+sp+'</span>'
            +'<span class="fob cr">edit</span></div>'
            +'<div class="fopre"><code>'+snip+'</code></div>'
            +'<div class="foa"><button class="foa-ok">✓ Apply</button>'
            +'<button class="foa-df">⊞ Diff</button>'
            +'<button class="foa-no">✗ Reject</button></div></div>';
    }
    return '<div class="foc" data-oi="'+idx+'"><div class="foh"><span>🗑</span><span class="fop">'+sp+'</span>'
        +'<span class="fob dl">delete</span></div>'
        +'<div class="foa"><button class="foa-ok">✓ Delete</button>'
        +'<button class="foa-no">✗ Cancel</button></div></div>';
}
function mkReadCard(paths){
    var d=document.createElement('div');
    d.className='frc'; d.dataset.paths=JSON.stringify(paths);
    d.innerHTML='<h4>🔍 Ciper wants to read:</h4>'
        +'<ul>'+paths.map(function(p){return '<li>'+esc(p)+'</li>';}).join('')+'</ul>'
        +'<div class="frca"><button class="frc-ok">✓ Allow</button>'
        +'<button class="frc-no">✗ Deny</button></div>';
    return d;
}

msgs.addEventListener('click',function(e){
    var t=e.target;
    if(t.classList.contains('cpb')){
        var code=t.nextElementSibling?t.nextElementSibling.textContent:'';
        navigator.clipboard.writeText(code).then(function(){t.textContent='Copied!';setTimeout(function(){t.textContent='Copy';},1500);});
        return;
    }
    var fc=t.closest('.foc');
    if(fc){
        var idx=parseInt(fc.dataset.oi,10), op=ops[idx];
        if(!op){return;}
        if(t.classList.contains('foa-ok')){t.disabled=true;t.textContent='…';VS.postMessage({command:'applyFileOp',action:op.a==='w'?'write':'delete',filePath:op.p,content:op.c});}
        else if(t.classList.contains('foa-df')){VS.postMessage({command:'previewFileOp',filePath:op.p,content:op.c});}
        else if(t.classList.contains('foa-no')){fc.innerHTML='<div class="for">✗ '+esc(op.p)+'</div>';}
        return;
    }
    var rc=t.closest('.frc');
    if(rc){
        if(t.classList.contains('frc-ok')){
            var paths=JSON.parse(rc.dataset.paths||'[]');
            rc.innerHTML='<div style="padding:6px;font-size:11px;color:var(--vscode-descriptionForeground)">📖 Reading…</div>';
            VS.postMessage({command:'readFiles',paths:paths});
        } else if(t.classList.contains('frc-no')){rc.remove();}
        return;
    }
    if(t.classList.contains('cnb')){
        t.remove();
        if(!streaming){VS.postMessage({command:'continueResponse'});}
        return;
    }
});

function mdRender(raw){
    var h=raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h=h.replace(/```(\w*)?\n([\s\S]*?)```/g,function(_,l,c){
        return '<pre><button class="cpb">Copy</button><code class="lang-'+(l||'')+'">'+ c+'</code></pre>';
    });
    h=h.replace(/`([^`\n]+)`/g,'<code>$1</code>');
    h=h.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    h=h.replace(/\*([^*]+)\*/g,'<em>$1</em>');
    h=h.replace(/^### (.+)$/gm,'<h3>$1</h3>');
    h=h.replace(/^## (.+)$/gm,'<h2>$1</h2>');
    h=h.replace(/^# (.+)$/gm,'<h1>$1</h1>');
    h=h.replace(/^[\-\*] (.+)$/gm,'<li>$1</li>');
    h=h.replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>');
    h=h.replace(/^\d+\. (.+)$/gm,'<li>$1</li>');
    h=h.replace(/\n\n/g,'</p><p>');
    h='<p>'+h+'</p>';
    h=h.replace(/([^>])\n([^<])/g,'$1<br>$2');
    return h;
}
function renderFull(raw){
    var os=exOps(raw), reads=exReads(raw), clean=stripTags(raw);
    var h=mdRender(clean);
    if(os.length){
        var st=ops.length;
        os.forEach(function(op,i){ops.push(op);h+=mkOpCard(op,st+i);});
    }
    return {html:h, reads:reads};
}

function addUser(text,imgs){
    var d=document.createElement('div');
    d.className='msg um'; d.textContent=text;
    if(imgs&&imgs.length){imgs.forEach(function(u){var img=document.createElement('img');img.className='uimg';img.src=u;d.appendChild(img);});}
    msgs.appendChild(d); scr();
}
function showTyp(){typEl=document.createElement('div');typEl.className='msg am td';typEl.innerHTML='<span></span><span></span><span></span>';msgs.appendChild(typEl);scr();}
function hideTyp(){if(typEl){typEl.remove();typEl=null;}}
function startAi(){rawBuf='';curAi=document.createElement('div');curAi.className='msg am streaming';msgs.appendChild(curAi);scr();}
function addChunk(chunk){
    if(typEl){hideTyp();startAi();}
    rawBuf+=chunk;
    if(curAi){curAi.innerHTML=mdRender(stripTags(rawBuf));scr();}
}
function finalAi(){
    if(!curAi){return;}
    var r=renderFull(rawBuf);
    curAi.innerHTML=r.html; curAi.classList.remove('streaming');
    curAi=null; rawBuf='';
    if(r.reads.length){msgs.appendChild(mkReadCard(r.reads));scr();}
    var cb=document.createElement('button');cb.className='cnb';cb.textContent='▶ Continue';
    msgs.appendChild(cb); scr();
}
function showErr(txt){var d=document.createElement('div');d.className='em';d.textContent=txt;msgs.appendChild(d);scr();}
function scr(){msgs.scrollTop=msgs.scrollHeight;}

function stripCtx(t){
    var cuts=[t.indexOf('\n\n[Project:'),t.indexOf('\n\n[File:'),t.indexOf('\n\nHere are the file contents')];
    var mn=Infinity;
    cuts.forEach(function(c){if(c>=0&&c<mn){mn=c;}});
    return mn===Infinity?t:t.slice(0,mn);
}
function loadHist(messages,sid){
    msgs.innerHTML=''; ops=[];
    if(sid){curSid=sid; ct.textContent='⚡ '+fmtSid(sid);}
    (messages||[]).forEach(function(m){
        if(m.role==='user'){addUser(stripCtx(m.content));}
        else if(m.role==='assistant'){var d=document.createElement('div');d.className='msg am';d.innerHTML=renderFull(m.content).html;msgs.appendChild(d);}
    });
    scr(); showV('c');
}

function setSt(on){streaming=on;sndb.disabled=on;stpb.style.display=on?'inline-block':'none';}
function send(){
    var txt=ci.value.trim();
    if(!txt||streaming){return;}
    setSt(true);
    var imgs=imgFiles.slice();
    addUser(txt,imgs);
    ci.value=''; ci.style.height='auto';
    showTyp();
    VS.postMessage({command:'sendMessage',text:txt,attachedFiles:atFiles.slice(),images:imgs});
    atFiles=[]; imgFiles=[];
    renderAB(); renderIB();
}
sndb.addEventListener('click',send);
stpb.addEventListener('click',function(){VS.postMessage({command:'stopStream'});});
ci.addEventListener('input',function(){ci.style.height='auto';ci.style.height=Math.min(ci.scrollHeight,120)+'px';});
ci.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});

window.addEventListener('message',function(e){
    var m=e.data;
    switch(m.type){
        case 'init':
            mn.textContent=m.model||'?';
            curSid=m.sessionId||'';
            ct.textContent='⚡ '+fmtSid(curSid);
            VS.postMessage({command:'loadHistory'});
            break;
        case 'modelChanged': mn.textContent=m.model; break;
        case 'streamStart': if(!streaming){setSt(true);showTyp();} break;
        case 'streamChunk': addChunk(m.data); break;
        case 'streamEnd': setSt(false); finalAi(); break;
        case 'streamAborted':
            setSt(false); if(curAi){finalAi();} hideTyp();
            var nb=document.createElement('div');nb.className='abm';nb.textContent='⊘ Stopped';msgs.appendChild(nb);scr();
            break;
        case 'error': setSt(false); hideTyp(); if(curAi){finalAi();} showErr(m.data); break;
        case 'clearHistory': msgs.innerHTML=''; ops=[]; break;
        case 'injectMessage': ci.value=m.text; break;
        case 'historyLoaded': loadHist(m.messages,m.sessionId); break;
        case 'sessionsLoaded': renderSL(m.sessions,m.currentSessionId); break;
        case 'newSessionCreated':
            curSid=m.sessionId; ct.textContent='⚡ '+fmtSid(curSid);
            msgs.innerHTML=''; ops=[]; showV('c');
            break;
        case 'sessionDeleted':
            if(m.newCurrentSessionId){curSid=m.newCurrentSessionId;}
            VS.postMessage({command:'loadSessions'});
            break;
        case 'filesAttached':
            (m.files||[]).forEach(function(f){atFiles.push(f);}); renderAB();
            break;
        case 'fileOpDone':
            msgs.querySelectorAll('.foc').forEach(function(c){
                var pe=c.querySelector('.fop');
                if(pe&&pe.textContent===m.filePath){
                    if(m.success){c.innerHTML='<div class="fod">✓ Applied: '+esc(m.filePath)+'</div>';}
                    else{var ab=c.querySelector('.foa-ok');if(ab){ab.disabled=false;ab.textContent='✓ Apply';}}
                }
            });
            break;
    }
});

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtSid(sid){
    if(sid&&sid.startsWith('chat_')){
        var ts=parseInt(sid.split('_')[1],10);
        if(!isNaN(ts)){return new Date(ts).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
    }
    return sid||'Chat';
}
function fmtDt(ts){
    if(!ts){return '';}
    try{return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
    catch(ex){return String(ts);}
}

VS.postMessage({command:'webviewReady'});

})();
