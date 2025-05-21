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
    console.error('Error in fetchAssociations main:', error);
    return { status: 'error', message: error.message, stack: error.stack };
  }
};

const fetchAssociations = async (token, id) => {
  try {
    // First, try to get the deal data and basic associations using REST API
    console.log(`Fetching deal ${id} and associations...`);
    
    // Get deal properties
    const dealResponse = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=deal_clone_number,dealname`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    
    const dealProperties = dealResponse.data.properties || {};
    console.log('Deal properties:', JSON.stringify(dealProperties, null, 2));
    
    // Get associations using REST API
    const associationTypes = [
      { type: 'contacts', key: 'deal_contact' },
      { type: 'companies', key: 'DEAL_TO_COMPANY' },
      { type: 'deals', key: 'original_deal_cloned_deal' },
      { type: 'tickets', key: 'ramp' }
    ];
    
    const result = {
      deal_clone_number: dealProperties.deal_clone_number || '0'
    };
    
    // Fetch each association type
    for (const assocType of associationTypes) {
      try {
        console.log(`Fetching ${assocType.type} associations for deal ${id}...`);
        
        const associationResponse = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/deals/${id}/associations/${assocType.type}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        
        const associations = associationResponse.data?.results || [];
        console.log(`Found ${associations.length} ${assocType.type} associations`);
        
        result[assocType.key] = associations.map(item => ({
          id: item.id,
          type: assocType.type
        }));
        
      } catch (assocError) {
        console.log(`No ${assocType.type} associations found for deal ${id}: ${assocError.message}`);
        result[assocType.key] = [];
      }
    }
    
    // Log the final result
    console.log('Final associations result:', JSON.stringify(result, null, 2));
    
    return result;
    
  } catch (error) {
    console.error('Error fetching deal associations:', error.message);
    
    // Fallback to GraphQL if REST API fails
    console.log('Falling back to GraphQL API...');
    return await fetchAssociationsGraphQL(token, id);
  }
};

const fetchAssociationsGraphQL = async (token, id) => {
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
    console.log('GraphQL response:', JSON.stringify(responseBody, null, 2));

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

    const deal = responseBody.data.CRM.deal;
    const assoc = deal.associations || {};
    const dealProperties = deal.properties || {};

    const mapItems = (items, type) => {
      if (!items || !Array.isArray(items)) return [];
      return items.map(i => ({ 
        id: i.hs_object_id || i.id, 
        type 
      }));
    };

    // Log raw associations for troubleshooting
    console.log('Raw associations from GraphQL:', JSON.stringify(assoc, null, 2));
    console.log('Deal properties from GraphQL:', JSON.stringify(dealProperties, null, 2));

    const result = {
      deal_contact: mapItems(assoc.contact_collection__deal_to_contact?.items, 'contacts'),
      DEAL_TO_COMPANY: mapItems(assoc.company_collection__deal_to_company_unlabeled?.items, 'companies'),
      original_deal_cloned_deal: mapItems(assoc.deal_collection__original_deal_cloned_deal?.items, 'deals'),
      ramp: mapItems(assoc.ticket_collection__deal_to_ticket?.items, 'tickets'),
      deal_clone_number: dealProperties.deal_clone_number || '0'
    };

    console.log('Mapped associations from GraphQL:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('Error fetching deal associations via GraphQL:', error.message);
    throw error;
  }
};

const QUERY = `
  query data($id: String!) {
    CRM {
      deal(uniqueIdentifier: "hs_object_id", uniqueIdentifierValue: $id) {
        hs_object_id
        properties {
          deal_clone_number
          dealname
        }
        associations {
          contact_collection__deal_to_contact { 
            items { 
              hs_object_id 
            } 
          }
          company_collection__deal_to_company_unlabeled { 
            items { 
              hs_object_id 
            } 
          }
          deal_collection__original_deal_cloned_deal { 
            items { 
              hs_object_id 
            } 
          }
          ticket_collection__deal_to_ticket { 
            items { 
              hs_object_id 
            } 
          }
        }
      }
    }
  }
`;