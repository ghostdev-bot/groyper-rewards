(function(){
  if('serviceWorker' in navigator) window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});
  var deferred=null,btn=document.getElementById('btnInstall');
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;btn.classList.remove('hidden');});
  btn.addEventListener('click',function(){if(!deferred)return;deferred.prompt();deferred.userChoice.finally(function(){deferred=null;btn.classList.add('hidden');});});
  window.addEventListener('appinstalled',function(){btn.classList.add('hidden');});
  var ios=/iphone|ipad|ipod/i.test(navigator.userAgent),standalone=window.navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  var hint=document.getElementById('iosHint');
  try{ if(ios&&!standalone&&!localStorage.getItem('groyper_ios_hint')) hint.classList.remove('hidden'); }catch(e){}
  document.getElementById('iosClose').addEventListener('click',function(){hint.classList.add('hidden');try{localStorage.setItem('groyper_ios_hint','1')}catch(e){}});
})();
