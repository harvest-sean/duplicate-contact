// Updated Extension.tsx

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DescriptionList,
  DescriptionListItem,
  Link,
  LoadingSpinner,
  Text,
  Flex,
  hubspot,
  type CrmContext,
} from '@hubspot/ui-extensions';

hubspot.extend<'crm.record.tab'>(({ context }) => (
  <Extension context={context} />
));

interface ExtensionProps {
  context: CrmContext;
}

export interface Association {
  total: number;
  items: { hs_object_id: number }[];
}

export interface DealAssociationsGQL {
  contact_collection__deal_to_contact: Association;
  company_collection__deal_to_company_unlabeled: Association;
  line_item_collection__primary: Association;
  quote_collection__primary: Association;
  ticket_collection__deal_to_ticket: Association;
  deal_collection__deal_to_deal: Association;
  deal_collection__original_deal_cloned_deal: Association;
}

const Extension = ({ context }: ExtensionProps) => {
  const [loading, setLoading] = useState(true);
  const [associations, setAssociations] = useState<DealAssociationsGQL>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [duplicatedDeals, setDuplicatedDeals] = useState<{ id: number, url: string }[]>([]);

  useEffect(() => {
    // Fetch associations to display existing duplicated deals
    hubspot
      .serverless('fetchAssociations', {
        propertiesToSend: ['hs_object_id'],
      })
      .then((response) => {
        const associations = response.associations as DealAssociationsGQL;
        setAssociations(associations);

        // Use the GraphQL response to get cloned deals
        const clonedDeals = associations.deal_collection__original_deal_cloned_deal?.items || [];
        const dealsWithUrls = clonedDeals.map(item => ({
          id: item.hs_object_id,
          url: `https://app.hubspot.com/contacts/${context.portal.id}/deal/${item.hs_object_id}`
        }));

        setDuplicatedDeals(dealsWithUrls);
      })
      .catch((error) => {
        setError(error.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const duplicateDeal = () => {
    setLoading(true);
  
    hubspot
      .serverless('duplicateDeal', {
        propertiesToSend: ['hs_object_id'],
        parameters: { associations },
      })
      .then((newDealId) => {
        // Ensure newDealId is a string or number representing the ID
        const newDealUrl = `https://app.hubspot.com/contacts/${context.portal.id}/deal/${newDealId}`;
        setUrl(newDealUrl);
        setDuplicatedDeals(prevDeals => [...prevDeals, { id: newDealId, url: newDealUrl }]);
      })
      .catch((error) => {
        setError(error.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  if (loading) {
    return <LoadingSpinner label="Fetching deal associations..." />;
  }

  if (error !== '') {
    return <Alert title="Error">{error}</Alert>;
  }

  if (associations && url === '') {
    return (
      <Flex direction="column" gap="lg">
        <Text variant="microcopy">
          Duplicate a deal along with some of its properties and associated objects.
        </Text>
        <Flex direction="column" gap="sm">
          <Text format={{ fontWeight: 'bold' }}>
            Number of associations to be copied:
          </Text>
          <DescriptionList direction="row">
            <DescriptionListItem label="Contacts">
              {associations.contact_collection__deal_to_contact?.total || 0}
            </DescriptionListItem>
            <DescriptionListItem label="Companies">
              {associations.company_collection__deal_to_company_unlabeled?.total || 0}
            </DescriptionListItem>
            <DescriptionListItem label="Line Items">
              {associations.line_item_collection__primary?.total || 0}
            </DescriptionListItem>
            <DescriptionListItem label="Quotes">
              {associations.quote_collection__primary?.total || 0}
            </DescriptionListItem> 
            <DescriptionListItem label="Tickets">
              {associations.ticket_collection__deal_to_ticket?.total || 0}
            </DescriptionListItem>
            <DescriptionListItem label="Deals">
              {associations.deal_collection__deal_to_deal?.total || 0}
            </DescriptionListItem>
          </DescriptionList>
          <Flex direction="row" justify="end">
            <Button onClick={duplicateDeal} variant="primary">
              Duplicate Deal
            </Button>
          </Flex>
          {duplicatedDeals.length > 0 && (
            <Flex direction="column" gap="sm" marginTop="lg">
              <Text format={{ fontWeight: 'bold' }}>View Duplicated Deals:</Text>
              {duplicatedDeals.map(deal => (
                <Link key={deal.id} href={deal.url} target="_blank">
                  Deal ID: {deal.id}
                </Link>
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>
    );
  }

  return (
    <Link href={url} target="_blank">
      {url}
    </Link>
  );
};

export default Extension;
