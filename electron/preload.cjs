const { contextBridge, ipcRenderer } = require('electron');
const invoke=(method,payload)=>ipcRenderer.invoke('studio:assistant',method,payload);
contextBridge.exposeInMainWorld('studioDesktop', Object.freeze({
  session:()=>invoke('session'), signIn:options=>invoke('signIn',options), cancel:()=>invoke('cancel'),
  selectProfile:id=>invoke('selectProfile',id), disconnect:()=>invoke('disconnect'), models:()=>invoke('models'),
  generate:payload=>invoke('generate',payload), openChatGPT:()=>invoke('openChatGPT'), openUsage:()=>invoke('openUsage'),
  copyText:text=>invoke('copyText',text), copyImage:image=>invoke('copyImage',image), readText:()=>invoke('readText')
}));
