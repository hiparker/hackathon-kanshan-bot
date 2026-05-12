-- 0002_pet_state_rules.sql
-- 对齐看山属性、道具效果与排序规则。

UPDATE items_catalog
SET effect_json = '{"hunger":10}',
    precondition = NULL,
    action_hint = NULL,
    sort_order = 1,
    updated_at = strftime('%s','now')
WHERE item_id = 'fish-jerky';

UPDATE items_catalog
SET effect_json = '{"hunger":50}',
    precondition = NULL,
    action_hint = NULL,
    sort_order = 2,
    updated_at = strftime('%s','now')
WHERE item_id = 'nutrition-can';

UPDATE items_catalog
SET effect_json = '{"spirit":5,"happiness":10}',
    precondition = NULL,
    action_hint = NULL,
    sort_order = 3,
    updated_at = strftime('%s','now')
WHERE item_id = 'yarn-ball';

UPDATE items_catalog
SET effect_json = '{"spirit":10,"happiness":20}',
    precondition = NULL,
    action_hint = NULL,
    sort_order = 4,
    updated_at = strftime('%s','now')
WHERE item_id = 'cat-baton';

UPDATE items_catalog
SET effect_json = '{"spirit":100}',
    precondition = NULL,
    action_hint = NULL,
    sort_order = 5,
    updated_at = strftime('%s','now')
WHERE item_id = 'energy-drink';

UPDATE items_catalog
SET effect_json = '{"set_hunger":50,"lifecycle":"normal"}',
    precondition = 'sick',
    action_hint = 'recover',
    sort_order = 98,
    updated_at = strftime('%s','now')
WHERE item_id = 'cold-medicine';

UPDATE items_catalog
SET effect_json = '{"set_hunger":50,"set_spirit":10,"set_happiness":10,"lifecycle":"normal"}',
    precondition = 'dead',
    action_hint = 'revive',
    sort_order = 99,
    updated_at = strftime('%s','now')
WHERE item_id = 'revive-feather';
