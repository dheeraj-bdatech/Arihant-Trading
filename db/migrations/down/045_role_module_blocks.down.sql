-- Reverts 045_role_module_blocks.sql: every role gets back the access the code gives it.

drop table if exists role_module_blocks;
