const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { requireAdmin } = require('../src/middleware/admin.middleware');
const { catalogData } = require('../src/routes/admin.routes');
test('admin is disabled without a key and rejects ordinary users and incorrect keys', async () => {
  const old=process.env.ADMIN_API_KEY;
  const app=express();app.get('/',requireAdmin,(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    delete process.env.ADMIN_API_KEY;assert.equal((await fetch(url)).status,503);
    process.env.ADMIN_API_KEY='test-admin-secret';
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{Authorization:'Bearer ordinary-user'}})).status,401);
    assert.equal((await fetch(url,{headers:{'X-Admin-Key':'wrong'}})).status,401);
    assert.equal((await fetch(url,{headers:{'X-Admin-Key':'test-admin-secret'}})).status,200);
  } finally {await new Promise(r=>server.close(r));if(old===undefined)delete process.env.ADMIN_API_KEY;else process.env.ADMIN_API_KEY=old;}
});
test('catalog rejects invalid economy values, colors and unsafe image references',()=>{
  const frame={name:'Frame',price:20,color:'#aabbcc',decoration:'★',imageUrl:'/api/uploads/1234-abcd.webp'};
  assert.equal(catalogData(frame,'frames').imageUrl,frame.imageUrl);
  for(const invalid of [{price:-1},{price:1.5},{color:'red'},{imageUrl:'javascript:alert(1)'},{imageUrl:'/etc/passwd'},{name:''}])assert.throws(()=>catalogData({...frame,...invalid},'frames'));
  assert.deepEqual(catalogData({name:'Blue',price:0,colorPreview:'#0000ff'},'themes'),{name:'Blue',price:0,colorPreview:'#0000ff'});
});
