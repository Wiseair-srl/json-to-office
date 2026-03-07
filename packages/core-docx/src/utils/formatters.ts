import { format } from 'date-fns';

export const formatDate = (
  date: Date,
  formatString: string = 'MMMM d, yyyy'
): string => {
  return format(date, formatString);
};
