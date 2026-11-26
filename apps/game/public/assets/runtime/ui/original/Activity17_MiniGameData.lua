local miniGameInfoDict

local function SetMiniGameInfo(info)
  miniGameInfoDict = miniGameInfoDict or {}
  miniGameInfoDict[info.gameId] = info
end

local function GetMiniGameInfo(gameId)
  if miniGameInfoDict then
    return miniGameInfoDict[gameId]
  end
end

local rankInfo

local function SetRankInfo(info)
  rankInfo = info
end

local function GetRankInfo()
  return rankInfo
end

return {
  SetMiniGameInfo = SetMiniGameInfo,
  GetMiniGameInfo = GetMiniGameInfo,
  SetRankInfo = SetRankInfo,
  GetRankInfo = GetRankInfo
}
