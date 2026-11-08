/* Shared Hamlet workspace navigation, search launcher and page deep-link support. */
(function(){
'use strict';
if(window.__hamletWorkspaceUX)return;
window.__hamletWorkspaceUX=true;
var routes=[
 {label:'Deal Pipeline',short:'Deals',href:'/app/hamlet/',icon:'▦',paths:['/app/hamlet','/app/hamlet/','/app/hamlet/index.html'],desc:'Find transactions and next actions.'},
 {label:'My Properties',short:'Properties',href:'/app/public/resources.html',icon:'⌂',paths:['/app/public/resources.html'],desc:'Search and manage properties you own.'},
 {label:'Live Listings',short:'Listings',href:'/app/public/live.html',icon:'▤',paths:['/app/public/live.html'],desc:'Discover active commercial property listings.'},
 {label:'Broker Dashboard',short:'Dashboard',href:'/app/public/dashboard.html',icon:'▣',paths:['/app/public/dashboard.html'],desc:'Manage your commercial property brokerage workspace.',searchable:false},
 {label:'Contacts & Directory',short:'Contacts',href:'/directory.html',icon:'♙',paths:['/directory.html'],desc:'Find members and start a conversation.'},
 {label:'Messages',short:'Messages',href:'/messages.html',icon:'✉',paths:['/messages.html'],desc:'Open your member mailbox.'},
 {label:'Social Feed',short:'Social',href:'/posts.html',icon:'◉',paths:['/posts.html'],desc:'Search community updates and posts.'},
 {label:'Archive',short:'Archive',href:'/archive.html',icon:'▱',paths:['/archive.html'],desc:'Find saved and archived communications.'},
 {label:'Account Settings',short:'Settings',href:'/settings.html',icon:'⚙',paths:['/settings.html'],desc:'Manage your profile, privacy and security.',searchable:false},
 {label:'Edit Profile',short:'Edit Profile',href:'/editprofile.html',icon:'♙',paths:['/editprofile.html'],desc:'Update your member profile details.',searchable:false},
 {label:'Invoices',short:'Invoices',href:'/invoice.html',icon:'▤',paths:['/invoice.html'],desc:'View subscription and payment options.',searchable:false},
 {label:'Members Area',short:'Members',href:'/members.html',icon:'▣',paths:['/members.html'],desc:'Open member resources and account tools.'}
];
var palette=null,paletteInput=null,paletteLinks=[],paletteRouteSelect=null,paletteStatus=null,lastFocus=null,previousBodyOverflow='';
function currentPath(){return (location.pathname||'/').replace(/\/$/,'')||'/'}
function withQuery(href,q){if(!q)return href;return href+(href.indexOf('?')>=0?'&':'?')+'q='+encodeURIComponent(q)}
function make(tag,cls,text){var node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node}
function buildNav(){
 var existing=document.querySelector('nav.workspace-nav');
 if(existing){
  /* Flatten previously grouped links so Edit Profile and Invoices remain visible
     as independent menu items for signed-in and signed-out visitors alike. */
  existing.querySelectorAll('.workspace-nav-group, .hamlet-nav-group').forEach(function(group){
   Array.prototype.slice.call(group.querySelectorAll('a[href]')).forEach(function(link){
    link.classList.remove('hamlet-nav-child');
    if(group.parentNode)group.parentNode.insertBefore(link,group);
   });
   if(group.parentNode)group.parentNode.removeChild(group);
  });
  routes.filter(function(r){return !r.parent}).forEach(function(r){
   var children=routes.filter(function(child){return child.parent===r.short});
   var existingLink=existing.querySelector('a[href="'+r.href+'"]');
   if(children.length){
    if(existing.querySelector('.workspace-nav-group[data-parent="'+r.short+'"]'))return;
    var group=make('details','hamlet-nav-group workspace-nav-group');group.setAttribute('data-parent',r.short);
    var summary=make('summary','workspace-nav-link',r.icon+' '+r.short+' ▾');group.appendChild(summary);
    children.forEach(function(child){var a=make('a','workspace-nav-link hamlet-nav-child');a.href=child.href;a.textContent=child.icon+' '+child.short;if(child.paths.indexOf(currentPath())!==-1){a.setAttribute('aria-current','page');group.open=true}group.appendChild(a)});
    if(existingLink&&existingLink.parentNode)existingLink.parentNode.replaceChild(group,existingLink);else existing.appendChild(group);
    return;
   }
   if(existingLink)return;
   var a=make('a','workspace-nav-link');a.href=r.href;a.appendChild(document.createTextNode(r.icon+' '+r.short));if(r.paths.indexOf(currentPath())!==-1){a.setAttribute('aria-current','page');a.title=r.label}if(r.external){a.target='_blank';a.rel='noopener noreferrer'}existing.appendChild(a)
  });
  /* Keep the global search on its own row below the workspace links to avoid
     horizontal overflow while keeping it aligned to the right. */
  var searchRow=existing.parentNode&&existing.parentNode.querySelector(':scope > .hamlet-global-search-row');
  if(!searchRow){
   searchRow=make('div','hamlet-global-search-row');
   if(existing.parentNode)existing.parentNode.insertBefore(searchRow,existing.nextSibling);
  }
  var searchButton=searchRow.querySelector('.hamlet-global-search');
  if(!searchButton){
   searchButton=make('button','hamlet-global-search','Search Hamlet');searchButton.type='button';
   searchButton.setAttribute('aria-haspopup','dialog');searchButton.setAttribute('aria-label','Search Hamlet (Ctrl or Command + K)');
   var keyLabel=make('kbd','','Ctrl K');searchButton.appendChild(keyLabel);searchButton.addEventListener('click',openPalette);searchRow.appendChild(searchButton);
  }
  return;
 }
 if(document.querySelector('.hamlet-primary-nav'))return;
 var header=document.querySelector('header.resource-nav, header.topbar, header.archive-topbar, header.legal-topbar, header.pricing-header');
 var nav=make('nav','hamlet-primary-nav');nav.setAttribute('aria-label','Hamlet workspace');
 var path=currentPath();
 routes.filter(function(r){return !r.parent}).forEach(function(r){
   var children=routes.filter(function(child){return child.parent===r.short});
   if(children.length){var group=make('details','hamlet-nav-group');var summary=make('summary','hamlet-nav-link');var icon=make('span','',r.icon);icon.setAttribute('aria-hidden','true');summary.appendChild(icon);summary.appendChild(document.createTextNode(' '+r.short+' ▾'));group.appendChild(summary);children.forEach(function(child){var a=make('a','hamlet-nav-link hamlet-nav-child');a.href=child.href;a.appendChild(document.createTextNode(child.icon+' '+child.short));if(child.paths.indexOf(path)!==-1){a.setAttribute('aria-current','page');a.title=child.label;group.open=true}group.appendChild(a)});nav.appendChild(group);return}
   var a=make('a','hamlet-nav-link');a.href=r.href;
   var icon=make('span','',r.icon);icon.setAttribute('aria-hidden','true');a.appendChild(icon);a.appendChild(document.createTextNode(' '+r.short));
   if(r.paths.indexOf(path)!==-1){a.setAttribute('aria-current','page');a.title=r.label}else a.title=r.label;
   if(r.external){a.target='_blank';a.rel='noopener noreferrer'}
   nav.appendChild(a);
 });
 var search=make('button','hamlet-global-search','Search Hamlet');search.type='button';search.setAttribute('aria-haspopup','dialog');search.setAttribute('aria-label','Search Hamlet (Ctrl or Command + K)');var key=make('kbd','','Ctrl K');search.appendChild(key);search.addEventListener('click',openPalette);nav.appendChild(search);
 if(header&&header.parentNode)header.parentNode.insertBefore(nav,header.nextSibling);else{var wrapper=document.querySelector('.page-wrapper')||document.body;wrapper.insertBefore(nav,wrapper.firstChild)}
}
function buildPalette(){
 if(palette)return;
 palette=make('div','hamlet-search-overlay');palette.hidden=true;palette.setAttribute('role','presentation');
 var dialog=make('section','hamlet-search-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','hamletSearchTitle');
 var head=make('div','hamlet-search-heading');var title=make('strong','','Search across Hamlet');title.id='hamletSearchTitle';head.appendChild(title);
 var close=make('button','hamlet-search-close','×');close.type='button';close.setAttribute('aria-label','Close search');close.addEventListener('click',closePalette);head.appendChild(close);dialog.appendChild(head);
 var form=make('form','hamlet-search-form');form.setAttribute('role','search');paletteInput=make('input','hamlet-search-input');paletteInput.type='search';paletteInput.maxLength=140;paletteInput.placeholder='Property, location, member, deal or post…';paletteInput.setAttribute('aria-label','Search term');form.appendChild(paletteInput);
 paletteRouteSelect=make('select','hamlet-search-route');paletteRouteSelect.setAttribute('aria-label','Choose where to search');var choose=make('option','','Choose workspace…');choose.value='';paletteRouteSelect.appendChild(choose);
 var submit=make('button','hamlet-search-submit','Search');submit.type='submit';form.appendChild(paletteRouteSelect);form.appendChild(submit);dialog.appendChild(form);
 paletteStatus=make('div','hamlet-search-status');paletteStatus.setAttribute('role','status');paletteStatus.setAttribute('aria-live','polite');paletteStatus.hidden=true;dialog.appendChild(paletteStatus);
 form.addEventListener('submit',async function(e){e.preventDefault();var q=paletteInput.value.trim(),target=paletteRouteSelect.value;await recordHamletWorkspaceSearch(q,target);if(!target){var path=currentPath(),current=routes.find(function(r){return r.paths.indexOf(path)!==-1});if(current&&current.href!='/messages.html'){target=current.href}else{paletteStatus.textContent='Choose a workspace below or select one from the destination menu.';paletteStatus.hidden=false;paletteRouteSelect.focus();return}}location.href=withQuery(target,q)});
 var caption=make('div','hamlet-search-caption','Choose where to search');dialog.appendChild(caption);
 var list=make('div','hamlet-search-destinations');
   var a=make('a','hamlet-search-destination');a.href=r.href;a.dataset.base=r.href;
   var strong=make('strong','',r.label);var desc=make('span','',r.desc);a.appendChild(strong);a.appendChild(desc);
   a.addEventListener('click',function(e){var q=paletteInput.value.trim();paletteRouteSelect.value=r.href;paletteLinks.forEach(function(link){link.classList.toggle('is-selected',link===a);link.setAttribute('aria-current',link===a?'true':'false')});if(q){e.preventDefault();location.href=withQuery(r.href,q)}});
   list.appendChild(a);paletteLinks.push(a);
 });
 dialog.appendChild(list);paletteRouteSelect.addEventListener('change',function(){paletteLinks.forEach(function(link){var selected=link.dataset.base===paletteRouteSelect.value;link.classList.toggle('is-selected',selected);if(selected)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current')})});var hint=make('div','hamlet-search-hint','Press Esc to close · Ctrl/Command + K to open');dialog.appendChild(hint);
 palette.appendChild(dialog);palette.addEventListener('click',function(e){if(e.target===palette)closePalette()});document.body.appendChild(palette);
 document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette();return}
  if(e.altKey&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette();return}
  if(!palette||palette.hidden)return;
  if(e.key==='Escape'){e.preventDefault();closePalette();return}
  if(e.key==='Tab'){var items=Array.from(palette.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])')).filter(function(el){return !el.hidden});if(!items.length)return;var first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
 });
}
function openPalette(){buildPalette();lastFocus=document.activeElement;previousBodyOverflow=document.body.style.overflow;palette.hidden=false;paletteInput.value='';paletteRouteSelect.value='';if(paletteStatus){paletteStatus.hidden=true;paletteStatus.textContent=''}paletteLinks.forEach(function(link){link.classList.remove('is-selected');link.removeAttribute('aria-current')});updatePaletteLinks();document.body.style.overflow='hidden';paletteInput.focus()}
function closePalette(){if(!palette||palette.hidden)return;palette.hidden=true;document.body.style.overflow=previousBodyOverflow;if(lastFocus&&typeof lastFocus.focus==='function')lastFocus.focus()}
function updatePaletteLinks(){var q=paletteInput?paletteInput.value.trim():'';paletteLinks.forEach(function(a){a.href=withQuery(a.dataset.base,q)})}
async function recordHamletWorkspaceSearch(rawQuery,target){
var query=String(rawQuery||'').trim().toLocaleLowerCase().replace(/[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/gi,'[email]').replace(/\\b\\d{6,}\\b/g,'[number]').slice(0,100);
if(query.length<2)return;
try{
if(window.__hamletAnalyticsFirebasePromise)await window.__hamletAnalyticsFirebasePromise;
if(!window.firebase||!firebase.firestore||!firebase.auth){
function load(src){return new Promise(function(resolve,reject){var absolute=new URL(src,location.href).href,found=Array.from(document.scripts).find(function(el){return el.src===absolute});if(found){if((src.indexOf('firebase-config.js')>=0&&window.firebaseConfig)||(src.indexOf('firebase-app-compat.js')>=0&&window.firebase&&firebase.apps)||(src.indexOf('firebase-auth-compat.js')>=0&&window.firebase&&firebase.auth)||(src.indexOf('firebase-firestore-compat.js')>=0&&window.firebase&&firebase.firestore))return resolve();found.addEventListener('load',resolve,{once:true});found.addEventListener('error',reject,{once:true});return;}var el=document.createElement('script');el.src=src;el.async=true;el.onload=resolve;el.onerror=reject;document.head.appendChild(el);});}
if(!window.firebase||!firebase.apps)await load('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
if(!window.firebase||!firebase.auth)await load('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js');
if(!window.firebase||!firebase.firestore)await load('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js');
if(!window.firebaseConfig)await load('/firebase-config.js');
}
if(!window.firebase||!window.firebaseConfig)throw new Error('Firebase configuration unavailable');
if(!firebase.apps.length)firebase.initializeApp(window.firebaseConfig);
var auth=firebase.auth();
await firebase.firestore().collection('searchAnalyticsEvents').add({query:query,area:'workspace:'+String(target||'auto').slice(0,70),path:String(location.pathname||'/').slice(0,160),uid:auth.currentUser?auth.currentUser.uid:null,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
}catch(e){console.debug('Search analytics event was not recorded:',e&&(e.code||e.message))}
}

function prefillSearch(){
 var params=new URLSearchParams(location.search),q=(params.get('q')||params.get('search')||'').trim().slice(0,140);if(!q)return;
 var path=currentPath(),id=null;
 if(path==='/app/hamlet'||path==='/app/hamlet/index.html')id='searchDeals';
 else if(path==='/app/public/resources.html')id='propertySearch';
 else if(path==='/app/public/live.html')id='listingSearch';
 else if(path==='/directory.html')id='directorySearchInput';
 else if(path==='/posts.html')id='postSearch';
 else if(path==='/messages.html')id='conversationSearch';
 else if(path==='/archive.html')id='archiveSearch';
 if(id){var field=document.getElementById(id);if(field){field.value=q;field.setAttribute('data-hamlet-deep-search','true');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))}}
}
function initialise(){buildNav();buildPalette();prefillSearch()}
initialise();
})();
