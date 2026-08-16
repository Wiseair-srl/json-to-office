import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  /* In-page surface → the 2px corner. Status variants follow the dashboard's
     callout recipe: a soft wash with the matching readable foreground, rather
     than a solid fill. The base status hues are tuned as fills — used as body
     text on their own wash they sit at 2.8:1-3.3:1 in light mode, so the
     -bg / -bg-foreground pair carries the text and the base hue stays on the
     icon, where the 3:1 graphics threshold applies. */
  'relative w-full rounded-sm border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-card text-foreground',
        destructive:
          'border-transparent bg-destructive-bg text-destructive-bg-foreground [&>svg]:text-destructive-bg-foreground',
        warning:
          'border-transparent bg-warning-bg text-warning-bg-foreground [&>svg]:text-warning-bg-foreground',
        success:
          'border-transparent bg-success-bg text-success-bg-foreground [&>svg]:text-success-bg-foreground',
        info: 'border-transparent bg-data-blue-bg text-data-blue-bg-foreground [&>svg]:text-data-blue-bg-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-medium leading-none tracking-tight', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
