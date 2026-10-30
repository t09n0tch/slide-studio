const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke=(method,payload)=>ipcRenderer.invoke('studio:service',method,payload);
const audio=(method,payload)=>ipcRenderer.invoke('studio:audio',method,payload);
contextBridge.exposeInMainWorld('studioDesktop', Object.freeze({
  serviceSession:()=>invoke('session'), connectService:code=>invoke('connect',code),
  disconnectService:()=>invoke('disconnect'), generateService:payload=>invoke('generate',payload), cancelService:()=>invoke('cancel'),
  prepareAudio:(file,options)=>audio('prepare',{...options,source:webUtils.getPathForFile(file)}),
  cancelAudio:()=>audio('cancel'), resetAudio:()=>audio('reset'), copyAudio:id=>audio('copy',id),
  dragAudio:id=>audio('drag',id), revealAudio:id=>audio('reveal',id), discardAudio:id=>audio('discard',id), openClova:()=>audio('open'),
  readTranscript:()=>audio('readText'),
  onAudioProgress:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('studio:audio-progress',listener);return()=>ipcRenderer.removeListener('studio:audio-progress',listener);}
}));
