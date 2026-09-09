import { useState } from 'react';
import { defineMessages, useIntl } from '../i18n';
import { usePreview } from '../tb/preview/PreviewContext';
import { toLocalFsPath } from '../tb/localPath';

const i18n = defineMessages({
  unableToLoad: {
    id: 'imagePreview.unableToLoad',
    defaultMessage: 'Unable to load image',
  },
  altText: {
    id: 'imagePreview.altText',
    defaultMessage: 'goose image',
  },
  clickToCollapse: {
    id: 'imagePreview.clickToCollapse',
    defaultMessage: 'Click to collapse',
  },
  clickToExpand: {
    id: 'imagePreview.clickToExpand',
    defaultMessage: 'Click to expand',
  },
});

interface ImagePreviewProps {
  src: string;
}

export default function ImagePreview({ src }: ImagePreviewProps) {
  const intl = useIntl();
  const preview = usePreview();
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState(false);

  // TB-Software: Bilder klickbar -> grosse Ansicht im rechten Panel.
  // Quelle kann ein lokaler Pfad ODER eine data:-URL (base64 aus der Nachricht) sein.
  const localPath = toLocalFsPath(src);
  const isDataUrl = /^data:(image|video)\//i.test(src);
  const canPanel = !!(preview && (localPath || isDataUrl));

  if (error) {
    return (
      <div className="text-red-500 text-xs italic mt-1 mb-1">
        {intl.formatMessage(i18n.unableToLoad)}
      </div>
    );
  }

  const handleClick = () => {
    if (preview && isDataUrl) {
      preview.openInline({
        name: 'Bild',
        dataUrl: src,
        kind: src.startsWith('data:video') ? 'video' : 'image',
      });
    } else if (preview && localPath) {
      preview.open(localPath);
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className={`image-preview mt-2 mb-2`}>
      <img
        src={src}
        alt={intl.formatMessage(i18n.altText)}
        onError={() => setError(true)}
        onClick={handleClick}
        title={canPanel ? 'Klick für grosse Ansicht (rechts)' : undefined}
        className={`rounded border border-border-primary cursor-pointer hover:border-border-primary transition-all ${
          isExpanded ? 'max-w-full max-h-96' : 'max-h-40 max-w-40'
        }`}
        style={{ objectFit: 'contain' }}
      />
      <div className="text-xs text-text-secondary mt-1">
        {canPanel
          ? 'Klick für grosse Ansicht (rechts)'
          : isExpanded
            ? intl.formatMessage(i18n.clickToCollapse)
            : intl.formatMessage(i18n.clickToExpand)}
      </div>
    </div>
  );
}
