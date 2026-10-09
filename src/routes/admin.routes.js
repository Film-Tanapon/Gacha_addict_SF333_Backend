const { Router } = require('express');
const prisma = require('../config/prisma');
const { requireAdmin } = require('../middleware/admin.middleware');
const { asyncHandler: wrap } = require('../middleware/error.middleware');
const v = require('../utils/input');
const router = Router();
router.use(requireAdmin);
const userSelect = { id:true, email:true, username:true, avatarUrl:true, phoneNo:true, isGoogle:true, coins:true, frameId:true, frameColor:true, frameUrl:true, selectedThemeId:true, createDate:true, updateDate:true, lastLoginDay:true };
const tables = { users:'user', cards:'card', items:'cardItem', results:'result', frames:'frame', themes:'theme', missions:'mission', favorites:'favorite', userFrames:'userFrame', userThemes:'userTheme', userMissions:'userMission', backups:'userBackup', syncedPulls:'syncedPull' };
router.get('/summary', wrap(async (req,res) => {
  res.json(Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([name,model]) => [name,await prisma[model].count()]))));
}));
router.get('/data/:table', wrap(async (req,res) => {
  const model = tables[req.params.table];
  if (!model) v.fail('Unknown table',404);
  const page = v.pagination(req.query);
  const orderBy = { users:{id:'asc'},cards:{id:'asc'},items:{id:'asc'},results:{id:'desc'},frames:{id:'asc'},themes:{id:'asc'},missions:{id:'asc'},favorites:[{userId:'asc'},{cardId:'asc'}],userFrames:[{userId:'asc'},{frameId:'asc'}],userThemes:[{userId:'asc'},{themeId:'asc'}],userMissions:[{userId:'asc'},{missionId:'asc'}],backups:{userId:'asc'},syncedPulls:[{userId:'asc'},{clientId:'asc'}] }[req.params.table];
  const [rows,total] = await Promise.all([prisma[model].findMany({...page,orderBy,...(model==='user'?{select:userSelect}:{})}),prisma[model].count()]);
  res.json({rows,total,...page});
}));
function catalogData(body, kind) {
  const data = { name:v.text(body.name,'name'),price:v.integer(body.price,'price',0) };
  const color = v.text(kind==='frames'?body.color:body.colorPreview,'color');
  if (!/^#[a-f\d]{6}$/i.test(color)) v.fail('Color must be a six-digit hex color');
  if (kind==='frames') {
    data.color=color;
    data.decoration=typeof body.decoration==='string'?body.decoration.trim():'';
    data.imageUrl=v.optionalText(body.imageUrl??null,'imageUrl');
    if (data.imageUrl && !/^\/api\/uploads\/[a-f\d-]+\.webp$/.test(data.imageUrl)) v.fail('Use an image uploaded to this server');
  } else data.colorPreview=color;
  return data;
}
for (const kind of ['frames','themes']) {
  const model = kind==='frames'?'frame':'theme';
  router.post('/'+kind,wrap(async(req,res)=>{
    const id=v.text(req.body.id,'id');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) v.fail('ID must use 1-100 letters, digits, hyphens or underscores');
    res.status(201).json(await prisma[model].create({data:{id,...catalogData(req.body,kind)}}));
  }));
  router.put('/'+kind+'/:id',wrap(async(req,res)=>{
    const data=catalogData(req.body,kind);
    const record=await prisma.$transaction(async tx=>{
      const saved=await tx[model].update({where:{id:req.params.id},data});
      if(model==='frame') await tx.user.updateMany({where:{frameId:req.params.id},data:{frameColor:saved.color,frameUrl:saved.imageUrl}});
      return saved;
    });
    res.json(record);
  }));
  router.delete('/'+kind+'/:id',wrap(async(req,res)=>{
    await prisma.$transaction(async tx=>{
      if(model==='frame') await tx.user.updateMany({where:{frameId:req.params.id},data:{frameId:null,frameColor:null,frameUrl:null}});
      await tx[model].delete({where:{id:req.params.id}});
    });
    res.sendStatus(204);
  }));
}
module.exports={router,catalogData};
