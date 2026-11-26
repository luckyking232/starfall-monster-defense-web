function table.appendTail(t1, t2)
  for i, v in ipairs(t2) do
    table.insert(t1, v)
  end
  return t1
end
function ParseConfigStr(str, delim_1, delim_2)
  local split = Split
  local mTable = {}
  local configs = split(str, delim_1 or ";")
  for i = 1, #configs do
    local data = split(configs[i], delim_2 or ":")
    mTable[#mTable + 1] = data
  end
  return mTable
end
