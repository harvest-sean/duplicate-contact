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

type AssociationList = { id: string | number; type: string }[];

interface DealAssociations {
  deal_contact?: AssociationList;
  DEAL_TO_COMPANY?: AssociationList;
  original_deal_cloned_deal?: AssociationList;
  ramp?: AssociationList;
}

const LABEL_MAP: { [key: string]: string } = {
  deal_contact: 'Contacts',
  DEAL_TO_COMPANY: 'Companies',
  original_deal_cloned_deal: 'Related Deals',
  ramp: 'Tickets',
};

const Extension = ({ context }: ExtensionProps) => {
  const dealId = context?.crm?.objectId;
  const [associations, setAssociations] = useState<DealAssociations>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [duplicatedDeals, setDuplicatedDeals] = useState<{ id: number; url: string }[]>([]);
  const [duplicating, setDuplicating] = useState(false);
  const [url, setUrl] = useState('');

  const associationsAreValid = (data: any) =>
    !!data && typeof data === 'object' && !('status' in data) && !('message' in data);

  const fetchAllAssociations = () => {
    if (!dealId) {
      setError('No deal ID found in context. This extension must be used inside a deal record.');
      setLoading(false);
      setAssociations({});
      return;
    }
    setLoading(true);
    setError('');
    (hubspot.serverless as any)('fetchAssociations', {
      parameters: { dealId }
    })
      .then((response: any) => {
        console.log('Associations fetched:', response);
        if (!associationsAreValid(response)) {
          setError('No associations found or error loading associations.');
          setAssociations({});
          return;
        }
        setAssociations(response as DealAssociations);

        // For Duplicated/Related Deals list
        const relatedDeals = (response as DealAssociations).original_deal_cloned_deal || [];
        const dealsWithUrls = relatedDeals.map(item => ({
          id: Number(item.id),
          url: `https://app.hubspot.com/contacts/${context.portal.id}/deal/${item.id}`,
        }));
        setDuplicatedDeals(dealsWithUrls);
      })
      .catch((err: any) => {
        setError(err?.message || 'Unknown error fetching associations.');
        setAssociations({});
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAllAssociations();
    // eslint-disable-next-line
  }, [dealId, context.portal.id]);

  const duplicateDeal = () => {
    if (!dealId || !associationsAreValid(associations)) {
      setError('No valid associations to duplicate.');
      return;
    }
    setDuplicating(true);
    setError('');
    setUrl('');
    (hubspot.serverless as any)('duplicateDeal', {
      parameters: { dealId, associations },
    })
      .then((result: any) => {
        let newDealId = '';
        if (result && result.status === 'ok' && result.newDealId) {
          newDealId = result.newDealId;
        } else if (typeof result === 'string' || typeof result === 'number') {
          newDealId = result.toString();
        }
        if (newDealId) {
          const newDealUrl = `https://app.hubspot.com/contacts/${context.portal.id}/deal/${newDealId}`;
          setUrl(newDealUrl);
          setDuplicatedDeals(prev => [...prev, { id: Number(newDealId), url: newDealUrl }]);
          // Refresh associations after creating a new deal
          setTimeout(() => fetchAllAssociations(), 2000);
        } else {
          setError('Failed to duplicate deal.');
        }
      })
      .catch((err: any) => {
        setError(err?.message || 'Unknown error duplicating deal.');
      })
      .finally(() => setDuplicating(false));
  };

  if (loading) {
    return <LoadingSpinner label="Fetching deal associations..." />;
  }
  if (error) {
    return (
      <Alert title="Error">
        <Text>{error}</Text>
        <Flex direction="row" justify="end">
          <Button
            variant="secondary"
            onClick={() => {
              setError('');
              setUrl('');
              fetchAllAssociations();
            }}
          >
            Retry
          </Button>
        </Flex>
      </Alert>
    );
  }
  if (!associationsAreValid(associations) || Object.keys(associations).length === 0) {
    return (
      <Alert title="No Associations Found">
        <Text>
          This deal has no contacts, companies, tickets, or other related records to duplicate.
        </Text>
      </Alert>
    );
  }

  // Calculate counts for each association type
  const associationCounts = Object.entries(LABEL_MAP).map(([key, label]) => {
    const count = associations[key as keyof DealAssociations]?.length ?? 0;
    return { key, label, count };
  });

  return (
    <Flex direction="column" gap="lg">
      <Text variant="microcopy">
        Duplicate a deal along with its properties and associations (contacts, companies, tickets, etc).
        Original and duplicated deals will be linked together.
      </Text>
      
      <DescriptionList direction="row">
        {associationCounts.map(({ key, label, count }) => (
          <DescriptionListItem label={label} key={key}>
            {count}
          </DescriptionListItem>
        ))}
      </DescriptionList>
      
      <Flex direction="row" justify="end">
        <Button
          onClick={duplicateDeal}
          variant="primary"
          disabled={
            duplicating ||
            !associationsAreValid(associations) ||
            Object.keys(associations).length === 0
          }
        >
          {duplicating ? 'Duplicating...' : 'Duplicate Deal'}
        </Button>
      </Flex>
      
      {/* List of related deals
      {duplicatedDeals.length > 0 && (
        <Flex direction="column" gap="sm" style={{ marginTop: '2rem' }}>
          <Text format={{ fontWeight: 'bold' }}>Related Deals:</Text>
          {duplicatedDeals.map(deal => (
            <Link key={deal.id} href={deal.url} external>
              Deal ID: {deal.id}
            </Link>
          ))}
        </Flex>
      )}
      
      {/* List of associated tickets */}
      {/* {associations.ramp?.length > 0 && (
        <Flex direction="column" gap="sm" style={{ marginTop: '1rem' }}>
          <Text format={{ fontWeight: 'bold' }}>Associated Tickets:</Text>
          {associations.ramp.map(ticket => (
            <Link
              key={ticket.id}
              href={`https://app.hubspot.com/contacts/${context.portal.id}/ticket/${ticket.id}`}
              external
            >
              Ticket ID: {ticket.id}
            </Link>
          ))}
        </Flex>
      )} */}
       
      {/* Link to new deal if created in this session */}
      {url && (
        <Flex direction="column" gap="sm" style={{ marginTop: '2rem' }}>
          <Text>New deal created:</Text>
          <Link href={url} external>
            {url}
          </Link>
        </Flex>
      )}
    </Flex>
  );
};

export default Extension;