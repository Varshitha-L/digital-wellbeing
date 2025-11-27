// bg.js - tracks tab usage and POSTs to backend when token present
const SOCIAL_SITES = ['youtube.com','instagram.com','facebook.com','reddit.com','twitter.com','tiktok.com'];
let activeTab = { id: null, url: null, start: Date.now() };

async function getJwt() {
  return new Promise(resolve => {
    chrome.storage.local.get(['wt_token'], res => resolve(res.wt_token || null));
  });
}

function domainFromUrl(url){
  try { return (new URL(url)).hostname; } catch(e) { return url || 'unknown'; }
}

async function recordSwitch(newUrl) {
  const now = Date.now();
  const seconds = Math.max(1, Math.floor((now - activeTab.start)/1000));
  const domain = domainFromUrl(activeTab.url || '');
  const label = SOCIAL_SITES.some(s => domain.includes(s)) ? 'social' : 'other';

  // buffer locally
  chrome.storage.local.get(['wt_buffer'], (res) => {
    const buf = res.wt_buffer || [];
    buf.push({ source: 'extension', name: domain, seconds, label, createdAt: new Date().toISOString() });
    chrome.storage.local.set({ wt_buffer: buf });
  });

  // try immediate send if token
  const token = await getJwt();
  if(token){
    try {
      const bufObj = await new Promise(r => chrome.storage.local.get(['wt_buffer'], res => r(res.wt_buffer || [])));
      if(bufObj.length){
        const resp = await fetch('http://localhost:8080/api/sync', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
          body: JSON.stringify({ sessions: bufObj }),
        });
        if(resp.ok){ chrome.storage.local.remove('wt_buffer'); }
      }
    } catch(e){ /* ignore, keep buffer */ }
  }

  activeTab = { id: activeTab.id, url: newUrl, start: now };
}

chrome.tabs.onActivated.addListener(async (info) => {
  const tab = await chrome.tabs.get(info.tabId);
  await recordSwitch(tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if(tab.active && changeInfo.url) {
    await recordSwitch(changeInfo.url);
  }
});

// when extension loads, set active tab
chrome.tabs.query({ active:true, currentWindow:true }, (tabs) => {
  if(tabs && tabs[0]) activeTab = { id: tabs[0].id, url: tabs[0].url, start: Date.now() };
});
