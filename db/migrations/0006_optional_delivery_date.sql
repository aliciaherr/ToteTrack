-- Make `requested_delivery_date` nullable so a scheduled order can be entered
-- before the salesperson knows the delivery date. The date is auto-populated
-- to CURRENT_DATE when an undated order is marked complete (see
-- updateOrderStatus action) so completed orders always carry a date for the
-- period-window stats and need-to-contact frequency calculations.
ALTER TABLE "orders" ALTER COLUMN "requested_delivery_date" DROP NOT NULL;
