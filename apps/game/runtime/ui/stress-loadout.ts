// Build the stress preset from the original card tables and battle choice methods.
export const STRESS_LOADOUT_LUA = String.raw`
local targetPerOption = 3
local budgetPerSkill = 3 * targetPerOption
local budgetPerCard = 3 * budgetPerSkill

local function selectSkill(unit, skillId, dealLevel)
  for _, candidate in ipairs(unit:GetCurSkillListForChoose(dealLevel)) do
    if candidate.id == skillId then
      unit:SaveSkill(skillId)
      return true
    end
  end
  return false
end

local function fillOptions(unit, options, budget, targetLevel, dealLevel)
  for _, option in ipairs(options) do
    while budget > 0 and unit:GetSkillLevel(option.id) < targetLevel
      and selectSkill(unit, option.id, dealLevel) do
      budget = budget - 1
    end
    option.level = unit:GetSkillLevel(option.id)
  end
  return budget
end

function StressLoadoutApply()
  local units = MiniGameBattleScene.cardList
  assert(#units == 5, 'The stress stage requires all five original heroes')
  -- Use the stage's last choice round to let the original prerequisite and cap checks run.
  local dealLevel = #MiniGameBattleData.stageConfig.level_time
  local report = {cards = {}, upgrades = 0}
  for _, unit in ipairs(units) do
    assert(unit:GetTotalSkillLevel() == 1, 'The stress loadout requires a fresh hero')
    local card = unit.baseConfig
    local skills = {
      {id = card.normal_skill, options = {}},
      {id = card.special_skill, options = {}},
      {id = card.talent_skill, options = {}}
    }
    local optionLists = {card.normal_skill_ext, card.special_skill_ext, card.talent_skill_ext}
    local overflow = 0
    for i, skill in ipairs(skills) do
      skill.unlocked = unit:GetSkillLevel(skill.id) == 1 or selectSkill(unit, skill.id, dealLevel)
      assert(skill.unlocked, 'Cannot unlock original skill ' .. skill.id)
      assert(#optionLists[i] == 3, 'The stress preset requires three options for skill ' .. skill.id)
      for _, optionId in ipairs(optionLists[i]) do
        local config = TableData.GetConfig(optionId, 'BaseShootSkill')
        skill.options[#skill.options + 1] = {id = optionId, maxLevel = config.level_max}
      end
      local remaining = fillOptions(unit, skill.options, budgetPerSkill, targetPerOption, dealLevel)
      overflow = overflow + fillOptions(unit, skill.options, remaining, budgetPerSkill, dealLevel)
    end
    -- Once each skill has had its full budget, spend the remainder on the same hero.
    for _, skill in ipairs(skills) do
      overflow = fillOptions(unit, skill.options, overflow, budgetPerCard, dealLevel)
    end
    report.cards[#report.cards + 1] = {id = unit.id, skills = skills}
    report.upgrades = report.upgrades + budgetPerCard - overflow
  end
  return report
end
`;
