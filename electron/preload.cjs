const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke=(method,payload)=>ipcRenderer.invoke('studio:assistant',method,payload);
const audio=(method,payload)=>ipcRenderer.invoke('studio:audio',method,payload);
contextBridge.exposeInMainWorld('studioDesktop', Object.freeze({
  session:()=>invoke('session'), signIn:options=>invoke('signIn',options), cancel:()=>invoke('cancel'),
  selectProfile:id=>invoke('selectProfile',id), disconnect:()=>invoke('disconnect'), models:()=>invoke('models'),
  generate:payload=>invoke('generate',payload), openChatGPT:()=>invoke('openChatGPT'), openUsage:()=>invoke('openUsage'),
  copyText:text=>invoke('copyText',text), copyImage:image=>invoke('copyImage',image), readText:()=>invoke('readText'),
  prepareAudio:(file,options)=>audio('prepare',{...options,source:webUtils.getPathForFile(file)}),
  cancelAudio:()=>audio('cancel'), resetAudio:()=>audio('reset'), copyAudio:id=>audio('copy',id),
  dragAudio:id=>audio('drag',id), revealAudio:id=>audio('reveal',id), discardAudio:id=>audio('discard',id), openClova:()=>audio('open'),
  readTranscript:()=>audio('readText'),
  onAudioProgress:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('studio:audio-progress',listener);return()=>ipcRenderer.removeListener('studio:audio-progress',listener);}
}));
