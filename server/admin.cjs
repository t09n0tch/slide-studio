'use strict';
const {createStore}=require('./store.cjs');
const {configuration}=require('./index.cjs');
const {encodeInvite,endpoint}=require('../shared/service-protocol.cjs');
const [command,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!/^--[a-z]+$/.test(args[i])||!args[i+1])throw Error('사용법: invite --name 이름 --endpoint https://서버주소 --daily 20 --monthly 200 --days 30');options[args[i].slice(2)]=args[i+1];}
const store=createStore(configuration().filename);try{
 if(command==='invite'){const address=endpoint(options.endpoint),user=store.invite({name:options.name,daily:Number(options.daily||20),monthly:Number(options.monthly||200),days:Number(options.days||30)});console.log(`사용자 ID: ${user.id}\n초대 코드는 이 사용자에게만 전달하세요.\n${encodeInvite(address,user.token)}`);}
 else if(command==='list')console.table(store.list());
 else if(command==='revoke'&&options.id){store.revoke(options.id);console.log('연결을 해제했습니다.');}
 else throw Error('명령: invite, list, revoke --id 사용자ID');
}finally{store.close();}
