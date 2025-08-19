// solver-worker.js

// ==== geometry helpers ====
function bbox(pts){
  if(pts.length===0) return {minX:0,minY:0,maxX:-1,maxY:-1}
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9
  for(const [x,y] of pts){
    if(x<minX)minX=x; if(y<minY)minY=y
    if(x>maxX)maxX=x; if(y>maxY)maxY=y
  }
  return {minX,minY,maxX,maxY}
}
function normalizeShape(pts){ if(pts.length===0) return []; const {minX,minY}=bbox(pts); return pts.map(([x,y])=>[x-minX,y-minY]) }
function rotate90(pts){ const res = pts.map(([x,y])=>[y,-x]); const {minX,minY}=bbox(res); return res.map(([x,y])=>[x-minX,y-minY]) }
function uniqShapes(list){
  const seen=new Set(), out=[]
  for(const s of list){
    const key=s.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(p=>p.join(',')).join(';')
    if(!seen.has(key)){ seen.add(key); out.push(s) }
  }
  return out
}
function generateVariants(shape, allowRot){
  if(shape.length===0) return [[]]
  let vars=[normalizeShape(shape)]
  if(allowRot){ for(let i=0;i<3;i++) vars.push(rotate90(vars[vars.length-1])) }
  return uniqShapes(vars)
}

// ==== board helpers ====
function placeable(board, pts, ox, oy){
  for(const [x,y] of pts){
    const gx=ox+x, gy=oy+y
    if(gx<0||gy<0||gx>=8||gy>=8) return false
    if(board[gy][gx]===1) return false
  }
  return true
}
function applyPlacement(board, pts, ox, oy){
  const b = board.map(r=>r.slice())
  for(const [x,y] of pts) b[oy+y][ox+x]=1
  return clearLines(b)
}
function clearLines(board){
  let cleared=0, fullRows=[], fullCols=[]
  for(let y=0;y<8;y++){ if(board[y].every(v=>v===1)){ fullRows.push(y); cleared++ } }
  for(let x=0;x<8;x++){ if(board.every(r=>r[x]===1)){ fullCols.push(x); cleared++ } }
  return {board, cleared, fullRows, fullCols}
}

// ==== full DFS solver (with memoization) ====
function permute(arr){
  const out=[], used=Array(arr.length).fill(false)
  function rec(path){
    if(path.length===arr.length){ out.push(path.slice()); return }
    for(let i=0;i<arr.length;i++) if(!used[i]){
      used[i]=true; path.push(arr[i]); rec(path); path.pop(); used[i]=false
    }
  }
  rec([]); return out
}
function solve(board, shapes, allowRot){
  const variants = shapes.map(s=>generateVariants(s, allowRot))
  const orders = permute([0,1,2])
  let best=null
  const memo=new Map()

  for(const order of orders){
    const res = dfs(board, variants, order, 0, [], 0)
    if(!best || better(res,best)) best=res
  }
  return best

  function dfs(curBoard, vars, order, idx, steps, totalCleared){
    if(idx===order.length) return {steps, totalCleared, board:curBoard}
    const id=order[idx]
    const varList=vars[id]

    const key=curBoard.flat().join('')+'-'+id
    if(memo.has(key)) return memo.get(key)

    let localBest=null
    if(varList.length===0 || (varList.length===1 && varList[0].length===0)){
      const r=dfs(curBoard,vars,order,idx+1,steps.slice(),totalCleared)
      if(!localBest||better(r,localBest)) localBest=r
    }
    for(const shape of varList){
      if(shape.length===0) continue
      const {maxX,maxY}=bbox(shape)
      for(let oy=0;oy<=8-(maxY+1);oy++){
        for(let ox=0;ox<=8-(maxX+1);ox++){
          if(!placeable(curBoard,shape,ox,oy)) continue
          const {board:nextBoard, cleared, fullRows, fullCols} = applyPlacement(curBoard,shape,ox,oy)
          const step={shapeId:id+1, ox, oy, shape, fullRows, fullCols}
          const r=dfs(nextBoard,vars,order,idx+1,steps.concat([step]),totalCleared+cleared)
          if(!localBest||better(r,localBest)) localBest=r
        }
      }
    }
    if(!localBest) localBest={steps,totalCleared,board:curBoard,dead:true}
    memo.set(key,localBest)
    return localBest
  }

  function better(a,b){
    if(!a) return false; if(!b) return true
    if(a.totalCleared!==b.totalCleared) return a.totalCleared>b.totalCleared
    const ea=a.board.flat().filter(v=>v===0).length
    const eb=b.board.flat().filter(v=>v===0).length
    if(ea!==eb) return ea>eb
    if(!!a.dead!==!!b.dead) return !a.dead
    return (a.steps?.length||0) < (b.steps?.length||0)
  }
}

// ==== heuristic fast solver ====
function fastSolve(board, shapes, allowRot){
  const variants = shapes.map(s=>generateVariants(s, allowRot))
  let steps=[]
  let totalCleared=0
  let curBoard=board.map(r=>r.slice())

  for(let id=0; id<3; id++){
    const varList=variants[id]
    let bestStep=null, bestScore=-1
    for(const shape of varList){
      if(shape.length===0) continue
      const {maxX,maxY}=bbox(shape)
      for(let oy=0;oy<=8-(maxY+1);oy++){
        for(let ox=0;ox<=8-(maxX+1);ox++){
          if(!placeable(curBoard,shape,ox,oy)) continue
          const {board:nextBoard, cleared, fullRows, fullCols} = applyPlacement(curBoard,shape,ox,oy)
          const emptyCount=nextBoard.flat().filter(v=>v===0).length
          const score=cleared*100+emptyCount
          if(score>bestScore){
            bestScore=score
            bestStep={shapeId:id+1,ox,oy,shape,fullRows,fullCols,nextBoard,cleared}
          }
        }
      }
    }
    if(bestStep){
      curBoard=bestStep.nextBoard
      steps.push(bestStep)
      totalCleared+=bestStep.cleared
    }
  }
  return {steps,totalCleared,board:curBoard}
}

// ==== handle messages ====
onmessage=(ev)=>{
  const {type,board,shapes,allowRot,t0}=ev.data
  let res=null
  if(type==="solve") res=solve(board,shapes,allowRot)
  if(type==="fastSolve") res=fastSolve(board,shapes,allowRot)
  if(type==="stepSolve") res=solve(board,shapes,allowRot)
  const t1=performance.now()
  postMessage({type,res,t0,t1})
}
