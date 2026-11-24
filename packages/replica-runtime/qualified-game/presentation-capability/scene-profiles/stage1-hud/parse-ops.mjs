const nil=v=>v==='-'?null:v;
const n=v=>v==='-'?null:+v;
export function parseHudOracle(blob){
  const data={cards:[]};
  for(const s of blob.split('\n')){
    const [op,...r]=s.split('\t');
    if(op==='phase')Object.assign(data,{hudPhase:r[0],fixedFrame:+r[1],displayFrame:+r[2],opsFixedFrame:+r[3],opsDisplayFrame:+r[4]});
    if(op==='top')data.top={time:r[0],wave:r[1],kills:r[2],level:r[3],exp:r[4],expFill:+r[5],wallName:r[6],
      wallHp:r[7],wallFill:+r[8],speed:r[9],speedPage:+r[10]};
    if(op==='card')data.cards.push({slot:+r[0],uid:n(r[1]),cardId:n(r[2]),dpsPage:+r[3],circle:nil(r[4]),damage:n(r[5]),
      dpsAssigned:n(r[6]),dpsTweenTo:n(r[7]),dpsTweenDuration:n(r[8]),cardPage:+r[9],countPage:n(r[10]),
      skillSum:nil(r[11]),portrait:nil(r[12]),skills:[]});
    if(op==='skill')data.cards[+r[0]-1].skills.push({slot:+r[1],id:+r[2],icon:r[3],lock:+r[4],level:n(r[5]),assignedCooldown:n(r[6])});
  }
  return data;
}
