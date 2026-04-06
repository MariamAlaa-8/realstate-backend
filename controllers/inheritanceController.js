const User = require('../models/users');
const FamilyMember = require('../models/FamilyMember');
const Contract = require('../models/Contract');
const Will = require('../models/Will');
const InheritanceExecution = require('../models/InheritanceExecution');

class InheritanceCalculator {
    
    static calculateShares(user, familyMembers) {
        const heirs = [];
        const shares = {};
        let remaining = 1; // 1 = 100%
        
        const hasSon = familyMembers.some(m => m.relationType === 'son' && m.isAlive);
        const daughters = familyMembers.filter(m => m.relationType === 'daughter' && m.isAlive);
        const hasWife = familyMembers.some(m => m.relationType === 'wife' && m.isAlive);
        const hasHusband = familyMembers.some(m => m.relationType === 'husband' && m.isAlive);
        const hasFather = familyMembers.some(m => m.relationType === 'father' && m.isAlive);
        const hasMother = familyMembers.some(m => m.relationType === 'mother' && m.isAlive);
        
        // CASE 1: Spouse shares
        if (hasWife) {
            if (hasSon || daughters.length > 0) {
                // Wife with children: 1/8
                shares.wife = 1/8;
                remaining -= 1/8;
            } else {
                // Wife without children: 1/4
                shares.wife = 1/4;
                remaining -= 1/4;
            }
        }
        
        if (hasHusband) {
            if (hasSon || daughters.length > 0) {
                // Husband with children: 1/4
                shares.husband = 1/4;
                remaining -= 1/4;
            } else {
                // Husband without children: 1/2
                shares.husband = 1/2;
                remaining -= 1/2;
            }
        }
        
        // CASE 2: Children shares
        if (hasSon && daughters.length > 0) {
            // Sons and daughters: male gets double female
            const totalShares = (1 * 2) + (daughters.length * 1);
            const sharePerUnit = remaining / totalShares;
            
            shares.son = sharePerUnit * 2;
            daughters.forEach((_, index) => {
                shares[`daughter_${index}`] = sharePerUnit;
            });
        } 
        else if (hasSon && daughters.length === 0) {
            // Only sons: all remaining to sons equally
            const sons = familyMembers.filter(m => m.relationType === 'son' && m.isAlive);
            shares.son = remaining / sons.length;
        } 
        else if (!hasSon && daughters.length > 0) {
            if (daughters.length === 1) {
                // One daughter: gets 1/2
                shares.daughter = 1/2;
            } else if (daughters.length === 2) {
                // Two daughters: get 2/3
                const daughtersShare = 2/3;
                shares.daughters = daughtersShare / daughters.length;
                remaining -= daughtersShare;
            } else {
                // Multiple daughters: get 2/3
                const daughtersShare = 2/3;
                shares.daughters = daughtersShare / daughters.length;
                remaining -= daughtersShare;
            }
        }
        
        // CASE 3: Parents shares
        if (hasFather && !hasSon && daughters.length === 0) {
            shares.father = remaining; // Father gets everything if no children
        } else if (hasFather) {
            shares.father = 1/6; // Father gets 1/6 with children
            remaining -= 1/6;
        }
        
        if (hasMother) {
            shares.mother = 1/6; // Mother gets 1/6
            remaining -= 1/6;
        }
        
        // Convert to array format
        const result = [];
        
        if (shares.wife) {
            const wife = familyMembers.find(m => m.relationType === 'wife');
            result.push({
                name: wife.fullName,
                relation: 'wife',
                share: shares.wife,
                nationalId: wife.nationalId
            });
        }
        
        if (shares.husband) {
            const husband = familyMembers.find(m => m.relationType === 'husband');
            result.push({
                name: husband.fullName,
                relation: 'husband',
                share: shares.husband,
                nationalId: husband.nationalId
            });
        }
        
        if (shares.son) {
            const sons = familyMembers.filter(m => m.relationType === 'son' && m.isAlive);
            sons.forEach(son => {
                result.push({
                    name: son.fullName,
                    relation: 'son',
                    share: shares.son / sons.length,
                    nationalId: son.nationalId
                });
            });
        }
        
        if (shares.daughter) {
            const daughter = familyMembers.find(m => m.relationType === 'daughter' && m.isAlive);
            result.push({
                name: daughter.fullName,
                relation: 'daughter',
                share: shares.daughter,
                nationalId: daughter.nationalId
            });
        }
        
        if (shares.daughters) {
            const daughters_list = familyMembers.filter(m => m.relationType === 'daughter' && m.isAlive);
            daughters_list.forEach(daughter => {
                result.push({
                    name: daughter.fullName,
                    relation: 'daughter',
                    share: shares.daughters,
                    nationalId: daughter.nationalId
                });
            });
        }
        
        if (shares.father) {
            const father = familyMembers.find(m => m.relationType === 'father');
            result.push({
                name: father.fullName,
                relation: 'father',
                share: shares.father,
                nationalId: father.nationalId
            });
        }
        
        if (shares.mother) {
            const mother = familyMembers.find(m => m.relationType === 'mother');
            result.push({
                name: mother.fullName,
                relation: 'mother',
                share: shares.mother,
                nationalId: mother.nationalId
            });
        }
        
        return result;
    }

    static async distributeProperties(deceasedId, heirs, contracts) {
        const execution = new InheritanceExecution({
            deceasedId,
            heirs: [],
            status: 'completed'
        });

        for (const contract of contracts) {
            const totalPercentage = contract.ownershipPercentage;
            
            for (const heir of heirs) {
                const heirShare = heir.share * totalPercentage;
                
                // Create new contract for heir
                const newContract = new Contract({
                    userId: heir.userId, // You'll need to map heir to user
                    fullName: heir.fullName,
                    nationalId: heir.nationalId,
                    phoneNumber: heir.phoneNumber || '',
                    propertyNumber: contract.propertyNumber,
                    ownershipPercentage: heirShare,
                    address: contract.address,
                    governorate: contract.governorate,
                    propertyType: contract.propertyType,
                    propertyCategory: contract.propertyCategory,
                    price: contract.price * heir.share,
                    area: contract.area,
                    status: 'completed',
                    contractImage: contract.contractImage
                });
                
                await newContract.save();
                
                execution.heirs.push({
                    familyMemberId: heir.familyMemberId,
                    nationalId: heir.nationalId,
                    fullName: heir.fullName,
                    relationType: heir.relation,
                    share: heir.share,
                    transferredProperties: [{
                        contractId: newContract._id,
                        propertyNumber: contract.propertyNumber,
                        percentage: heirShare
                    }]
                });
            }
            
            contract.status = 'inherited';
            await contract.save();
        }
        
        await execution.save();
        return execution;
    }
}

module.exports = InheritanceCalculator;