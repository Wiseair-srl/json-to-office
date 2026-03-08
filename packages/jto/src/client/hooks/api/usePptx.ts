import { useMutation } from '@tanstack/react-query';
import { pptxService } from '@/api';
import { FORMAT, FORMAT_EXT } from '@/lib/env';

export function useGeneratePptx() {
  return useMutation({
    mutationFn: (code: string) => pptxService.generate(code),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${FORMAT === 'docx' ? 'document' : 'presentation'}-${new Date().toISOString()}${FORMAT_EXT}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
