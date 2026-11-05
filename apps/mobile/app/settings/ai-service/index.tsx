import { AIServiceEditor } from "../../../src/ui/settings/AIServiceEditor";
import { useAIServiceDraft } from "../../../src/ui/settings/AIServiceDraft";
import { useAIServiceNavigation } from "../../../src/ui/settings/AIServiceNavigation";
export default function AIServiceRoute() {
  const { closeEditor } = useAIServiceNavigation();
  const { service, selected } = useAIServiceDraft();
  return (
    <AIServiceEditor
      service={service}
      selected={selected}
      onClose={closeEditor}
      onChanged={() => undefined}
    />
  );
}
