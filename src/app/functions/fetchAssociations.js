const axios = require('axios');

exports.main = async (context = {}) => {
  const { dealId } = context.parameters || {};
  const token = process.env['PRIVATE_APP_ACCESS_TOKEN'];

  if (!dealId) {
    return { status: 'error', message: 'No dealId provided!' };
  }
  if (!token) {
    return { status: 'error', message: 'No HubSpot Private App token available!' };
  }

  try {
    return await fetchAssociations(token, dealId);
  } catch (error) {
    return { status: 'error', message: error.message, stack: error.stack };
  }
};

const fetchAssociations = async (token, id) => {
  const requestBody = {
    operationName: 'data',
    query: QUERY,
    variables: { id: String(id) },
  };

  try {
    const response = await axios.post(
      'https://api.hubapi.com/collector/graphql',
      JSON.stringify(requestBody),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const responseBody = response.data;

    if (responseBody.errors && responseBody.errors.length > 0) {
      throw new Error(`GraphQL Error: ${JSON.stringify(responseBody.errors)}`);
    }
    if (
      !responseBody.data ||
      !responseBody.data.CRM ||
      !responseBody.data.CRM.deal
    ) {
      throw new Error('No CRM deal data returned. Check deal ID and API scopes.');
    }

    const assoc = responseBody.data.CRM.deal.associations || {};

    const mapItems = (arr, type) =>
      (arr || []).map(i => ({ id: i.hs_object_id, type }));

    // Log raw for troubleshooting
    console.log('Raw associations from API:', JSON.stringify(assoc, null, 2));

    return {
      deal_contact: mapItems(assoc.contact_collection__deal_to_contact?.items, 'contacts'),
      DEAL_TO_COMPANY: mapItems(assoc.company_collection__deal_to_company_unlabeled?.items, 'companies'),
      original_deal_cloned_deal: mapItems(assoc.deal_collection__original_deal_cloned_deal?.items, 'deals'),
      ramp: mapItems(assoc.ticket_collection__deal_to_ticket?.items, 'tickets') // Tickets
    };
  } catch (error) {
    console.error('Error fetching deal associations:', error.message);
    throw error;
  }
};

const QUERY = `
  query data ($id: String!) {
    CRM {
      deal(uniqueIdentifier: "hs_object_id", uniqueIdentifierValue: $id) {
        hs_object_id
        associations {
          contact_collection__deal_to_contact { items { hs_object_id } }
          company_collection__deal_to_company_unlabeled { items { hs_object_id } }
          deal_collection__original_deal_cloned_deal { items { hs_object_id } }
          ticket_collection__deal_to_ticket { items { hs_object_id } }
        }
      }
    }
  }
`;