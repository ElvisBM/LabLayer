import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { assetId } from '../../../shared/assets/model';
import { QuoteImage } from './PublicQuoteImage';
export { QuoteImage, AssistantQuoteImage } from './PublicQuoteImage';

export function TenantQuoteImage({reference,text}:{reference?:string;text:string}) {
  const {user,tenantId}=useAuth(); const id=assetId(reference || '');
  if (!id || !user || !tenantId) return null;
  return <QuoteImage imageKey={`${tenantId}:${user.uid}:${id}`} text={text} load={async()=>{
    const response=await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/assets/${id}/download`,{headers:{Authorization:`Bearer ${await user.getIdToken()}`}});
    if(!response.ok)throw Error();return response.blob();
  }}/>;
}
