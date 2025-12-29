import { Result, Button } from 'antd';
import React from 'react';
import { history } from '@umijs/max';
import { useI18n } from '../../i18n';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div style={{ padding: 24 }}>
      <Result
        status="404"
        title={t('notfound.title')}
        subTitle={t('notfound.subTitle')}
        extra={
          <Button type="primary" onClick={() => history.push('/overview')}>
            {t('notfound.backHome')}
          </Button>
        }
      />
    </div>
  );
}
