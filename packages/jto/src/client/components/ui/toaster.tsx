import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from './toast';
import { useToast } from './use-toast';

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastViewport>
      {toasts.map(function ({
        id,
        title,
        description,
        action,
        open,
        ...props
      }) {
        // Don't render toasts that are closed
        if (open === false) return null;

        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(id);
              }}
            />
          </Toast>
        );
      })}
    </ToastViewport>
  );
}
