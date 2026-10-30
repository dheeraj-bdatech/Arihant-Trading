-- Reverts 046_dashboard_layouts.sql: everyone's dashboard goes back to the default layout.

drop table if exists dashboard_layouts;
