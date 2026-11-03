/* Shared animated Hamlet network background. */
(function(){
  'use strict';
  var path=(location.pathname||'/').replace(/\/$/,'')||'/';
  if(path==='/app/hamlet'||path==='/app/hamlet/index.html'||path==='/members.html'||path.indexOf('/app/public/')===0)return;
  if(document.getElementById('hamlet-particles-background'))return;
  var style=document.createElement('style');
  style.id='hamlet-particles-background-style';
  style.textContent='html{min-height:100%;background:transparent!important}body{position:relative;isolation:isolate;background:transparent!important}#hamlet-particles-background{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;overflow:hidden;background:transparent}#hamlet-particles-background canvas{display:block;width:100%;height:100%}body>*:not(#hamlet-particles-background):not(.hamlet-search-overlay){position:relative;z-index:1}body>.page-wrapper,body>main,body>.container,body>.team-container,body>.site-content,body>.page-content,body>.app-shell,body>.content-wrapper,body>.directory-shell,body .page-wrapper,body .team-container,body .site-content,body .page-content,body .app-shell,body .content-wrapper,html[data-appearance="dark"] body:has(.directory-shell) .page-wrapper{background:transparent!important;background-color:transparent!important;background-image:none!important}';
  (document.head||document.documentElement).appendChild(style);
  var layer=document.createElement('div');
  layer.id='hamlet-particles-background';layer.setAttribute('aria-hidden','true');layer.style.background='#0b1120';
  function start(){
    if(!document.body)return;
    document.body.insertBefore(layer,document.body.firstChild);
    function init(){
      if(typeof window.particlesJS!=='function')return;
      window.particlesJS('hamlet-particles-background',{
        particles:{number:{value:62,density:{enable:true,value_area:950}},color:{value:'#dbeafe'},shape:{type:'circle'},opacity:{value:.42,random:true,anim:{enable:false}},size:{value:2.4,random:true,anim:{enable:false}},line_linked:{enable:true,distance:145,color:'#93c5fd',opacity:.24,width:1},move:{enable:true,speed:1.25,direction:'none',random:false,straight:false,out_mode:'out',bounce:false}},
        interactivity:{detect_on:'canvas',events:{onhover:{enable:true,mode:'grab'},onclick:{enable:false},resize:true},modes:{grab:{distance:125,line_linked:{opacity:.35}}}},retina_detect:true
      });
    }
    if(typeof window.particlesJS==='function'){init();return}
    var script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js';
    script.onload=init;script.async=true;document.head.appendChild(script);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();