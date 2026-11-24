-- Additional read-only independent observation of the original buff threshold.
local New=MiniGameBattleUnit.NewUnit
local transitions={}
local k=MINI_GAME_BUFF_EFFECT_ID.MOVE_SPD_CHANGE_WITH_EFFECT
assert(k==2011,"Unexpected original slowmotion threshold")
MiniGameBattleUnit.NewUnit=function(...)
  local u=New(...)
  local buff=u.UpdateBuffEffect
  if not buff then return u end
  function u:UpdateBuffEffect(...)
    local before=self.moveSpdEffect~=nil
    local present=self:ContainEffectId(k)
    local ret=buff(self,...)
    local after=self.moveSpdEffect~=nil
    if before~=after then
      assert(type(present)=="boolean" and after==present)
      transitions[#transitions+1]=table.concat({self.uid,self.id,present and 1 or 0,before and 1 or 0,after and 1 or 0,k},"	")
    end
    return ret
  end
  return u
end
function slowThresholdDrain()
  local x=table.concat(transitions,"\n")
  transitions={}
  return x
end
