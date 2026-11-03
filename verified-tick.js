(function(global){
  'use strict';
  const EMAIL_PATTERN=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const SVG='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.2 14.3 3l2.9-.3 1.4 2.5 2.7 1.1-.3 2.9 1.8 2.8-1.8 2.3.3 2.9-2.7 1.1-1.4 2.5-2.9-.3L12 22.8 9.7 21l-2.9.3-1.4-2.5-2.7-1.1.3-2.9L1.2 12l1.8-2.3-.3-2.9 2.7-1.1 1.4-2.5 2.9.3z"/><path d="m7.2 12.1 3.1 3.1 6.7-6.7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function isValidEmail(value){return typeof value==='string'&&EMAIL_PATTERN.test(value.trim());}
  function markup(email){
    if(!isValidEmail(email))return '';
    return '<span class="email-verified-tick" role="img" aria-label="Verified by e-mail" title="Verified by e-mail">'+SVG+'</span>';
  }
  function create(email){
    if(!isValidEmail(email))return null;
    const badge=document.createElement('span');
    badge.className='email-verified-tick';
    badge.setAttribute('role','img');
    badge.setAttribute('aria-label','Verified by e-mail');
    badge.title='Verified by e-mail';
    badge.innerHTML=SVG;
    return badge;
  }
  global.IBRVerifiedTick=Object.freeze({isValidEmail,markup,create});
})(window);
