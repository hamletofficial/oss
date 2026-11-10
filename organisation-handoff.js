(function(){
'use strict';
const MAIN_ORIGIN=location.origin;
const STAGING_TENANT_ORIGIN='https://hamlet-organisations-router-staging.alfred-mayaki.workers.dev';
let pending=null;
function message(text,error){let el=document.getElementById('notice');if(!el){el=document.createElement('div');el.id='notice';el.className='notice';const toolbar=document.querySelector('.toolbar');if(toolbar)toolbar.after(el);}el.textContent=text;el.className='notice show'+(error?' error':'');}
function setup(){
 const select=document.getElementById('orgSelect');
 const toolbar=document.querySelector('.toolbar');
 if(!select||!toolbar||!window.firebase)return;
 const button=document.createElement('button');
 button.type='button';button.id='openTenantWorkspace';button.textContent='Open dedicated workspace';button.disabled=true;
 button.style.cssText='min-height:42px;padding:10px 14px;border:1px solid #3b82f6;border-radius:9px;background:#1d4ed8;color:#fff;font:700 12px inherit;cursor:pointer';
 toolbar.appendChild(button);
 function selected(){const id=select.value;return id?window.__hamletOrganisationChoices&&window.__hamletOrganisationChoices.find(o=>o.id===id):null;}
 button.disabled=!select.value;
 select.addEventListener('change',()=>{button.disabled=!select.value;});
 button.addEventListener('click',()=>{
  const org=selected();
  if(!org||!org.slug){message('Select an active organisation with a valid tenant address first.',true);return;}
  const origin=STAGING_TENANT_ORIGIN;
  const popup=window.open(origin+'/tenant/'+encodeURIComponent(org.slug),'hamletTenant_'+org.slug);
  if(!popup){message('Allow pop-ups for Hamlet to open the secure organisation workspace.',true);return;}
  pending={popup,org,origin,startedAt:Date.now()};
  message('Waiting for the organisation workspace to establish a secure sign-in handoff…');
  setTimeout(()=>{if(pending&&pending.popup===popup){pending=null;message('The organisation workspace did not respond. Check the tenant route and try again.',true);}},20000);
 });
 window.addEventListener('message',async event=>{
  if(!pending||event.source!==pending.popup||event.origin!==pending.origin)return;
  const data=event.data||{};
  if(data.type==='HAMLET_ORGANISATION_HANDOFF_COMPLETE'&&data.slug===pending.org.slug){message('Secure sign-in complete. Your organisation workspace is open.');pending=null;return;}
  if(data.type!=='HAMLET_ORGANISATION_HANDOFF_READY'||data.slug!==pending.org.slug)return;
  try{
   if(!firebase.apps.length)firebase.initializeApp(window.firebaseConfig);
   const user=firebase.auth().currentUser;
   if(!user)throw new Error('Your Hamlet session has expired. Sign in again.');
   await user.reload();
   if(user.emailVerified!==true)throw new Error('Verify your email address before opening an organisation workspace.');
   const functions=firebase.app().functions('europe-west2');
   const result=await functions.httpsCallable('createOrganisationHandoffCode')({organisationId:pending.org.id,slug:pending.org.slug});
   if(!pending)return;
   pending.popup.postMessage({type:'HAMLET_ORGANISATION_HANDOFF',slug:pending.org.slug,code:result.data.code},pending.origin);
   message('A short-lived, single-use sign-in code has been issued to this organisation tab.');
  }catch(error){console.error('Unable to create organisation handoff:',error);message(error.message||'The secure handoff could not be created.',true);try{pending.popup.close();}catch(e){}pending=null;}
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();