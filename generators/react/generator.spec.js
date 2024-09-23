import { beforeAll, describe, expect, it } from 'vitest';

import { defaultHelpers as helpers, result } from 'generator-jhipster/testing';

const SUB_GENERATOR = 'react';
const BLUEPRINT_NAMESPACE = `jhipster:${SUB_GENERATOR}`;

describe('SubGenerator react of quarkus JHipster blueprint', () => {
    describe('run', () => {
        beforeAll(async function () {
            await helpers
                .run(BLUEPRINT_NAMESPACE)
                .withJHipsterConfig({
                    clientFramework: 'react',
                })
                .withOptions({
                    ignoreNeedlesError: true,
                    blueprint: ['quarkus'],
                })
                .withJHipsterLookup()
                .withParentBlueprintLookup();
        });

        it('should succeed', () => {
            expect(result.getStateSnapshot()).toMatchSnapshot();
        });
    });
});
