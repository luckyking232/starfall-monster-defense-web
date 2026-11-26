-- Exact headless addition, intentionally not a visual-particle renderer.
-- Load after the pinned Stage1 engine and combat prefix, only with verified-native receipt.
local path="assets/art/effects/prefab/ui_prefab/minigame/minigame022/minigame022_10000134_skill2_summon.prefab"
local existingInstantiate, existingFindChild = ResourceManager.Instantiate, LuaUtil.FindChild
local nativeModels=setmetatable({}, {__mode="k"})
ResourceManager.Instantiate=function(name)
  if type(name)=="string" and name:lower()==path then
    local model={
      transform={localScale={x=1,y=1,z=1}},
      GetComponentInChildren=function(_,ty)
        assert(ty=="Animator","unclosed Dina summon component "..tostring(ty))
        return nil
      end,
      Get3DPositionToUIPosition=function() return nil end,
    }
    nativeModels[model]=true
    return model
  end
  return existingInstantiate(name)
end
LuaUtil.FindChild=function(model, name, ...)
  if nativeModels[model] then
    assert(name=="model" or name=="bullet" or name=="hit","unclosed Dina summon child "..tostring(name))
    return nil
  end
  return existingFindChild(model,name,...)
end
