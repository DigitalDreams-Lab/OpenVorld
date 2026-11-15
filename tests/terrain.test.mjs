import test from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from './helpers/client.mjs';
const { roadConnections, paintRoadTile }=await clientModule('engine/client/src/game/terrain.ts');

test('path edges follow straight roads, corners, junctions, plaza and bridge connections',()=>{
  const cases=[
    {ground:['000','ppp','000'],connected:{north:false,east:true,south:false,west:true}},
    {ground:['0p0','0p0','0p0'],connected:{north:true,east:false,south:true,west:false}},
    {ground:['0P0','ppb','000'],connected:{north:true,east:true,south:false,west:true}},
    {ground:['0p0','ppp','0p0'],connected:{north:true,east:true,south:true,west:true}},
  ];
  for(const {ground,connected} of cases){
    assert.deepEqual(roadConnections({ground},1,1),connected);
    const draws=[],rotations=[],g={drawImage:(...args)=>draws.push(args),save(){},restore(){},translate(){},rotate:r=>rotations.push(r)};
    const image={width:48,height:48};paintRoadTile(g,image,16,32,16,connected);
    assert.deepEqual(draws[0],[image,12,12,24,24,16,32,16,16],'the material is cropped away from baked borders');
    assert.equal(rotations.length,Object.values(connected).filter(v=>!v).length,'draw borders only on exposed edges');
  }
  assert.deepEqual(roadConnections({ground:['p']},0,0),{north:false,east:false,south:false,west:false});
});
