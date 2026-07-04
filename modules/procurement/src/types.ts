export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface ProcurementRequest {
  id: string;
  title: string;
  description?: string;
  department?: string;
  status: RequestStatus;
  estimatedAmount?: number;
  createdAt: string;
}
