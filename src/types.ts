export type Profile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

export type Group = {
  id: string;
  name: string;
  created_at: string;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  role: "admin" | "member";
  created_at: string;
};

export type ReceiptStatus =
  | "pending"
  | "processing"
  | "needs_review"
  | "completed"
  | "error";

export type Receipt = {
  id: string;
  user_id: string;
  group_id: string;
  image_url: string;
  city: string | null;
  status: ReceiptStatus;
  raw_ocr_json: unknown | null;
  created_at: string;
  updated_at: string;
};

export type TransactionType = "income" | "expense";

export type Product = {
  id: string;
  group_id: string;
  name: string;
  category: string | null;
  created_at: string;
};

export type TransactionItem = {
  id: string;
  transaction_id: string;
  product_id: string | null;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  item_total: number;
  created_at: string;
};

export type Transaction = {
  id: string;
  receipt_id: string | null;
  user_id: string;
  group_id: string;
  type: TransactionType;
  is_reviewed: boolean;
  vendor_or_source: string | null;
  date: string | null;
  total_amount: number | null;
  currency: string;
  transaction_items?: TransactionItem[];
  receipts?: Pick<Receipt, "raw_ocr_json" | "status">;
  created_at: string;
  updated_at: string;
};
