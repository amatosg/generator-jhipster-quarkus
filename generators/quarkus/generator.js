import os from 'os';
import chalk from 'chalk';
import BaseApplicationGenerator from 'generator-jhipster/generators/base-application';
import {
    GENERATOR_BOOTSTRAP_APPLICATION,
    GENERATOR_DOCKER,
    GENERATOR_GRADLE,
    GENERATOR_JAVA,
    GENERATOR_LANGUAGES,
    GENERATOR_LIQUIBASE,
    GENERATOR_MAVEN,
    GENERATOR_SERVER,
} from 'generator-jhipster/generators';
import command from './command.js';
import { serverFiles } from './files.js';
import { entityQuarkusFiles } from './entity-files.js';
import { CACHE_EXPIRE_AFTER_WRITE, CACHE_MAXIMUM_SIZE, DEFAULT_DATA_ACCESS } from '../constants.js';
import { createNeedleCallback } from 'generator-jhipster/generators/base/support';

export default class extends BaseApplicationGenerator {
    async beforeQueue() {
        await this.dependsOnJHipster(GENERATOR_BOOTSTRAP_APPLICATION);
        (await this.dependsOnJHipster(GENERATOR_JAVA)).generateEntities = false;
        await this.dependsOnJHipster(GENERATOR_SERVER);
    }

    get [BaseApplicationGenerator.INITIALIZING]() {
        return this.asInitializingTaskGroup({
            async initializingTemplateTask() {
                this.parseJHipsterArguments(command.arguments);
                this.parseJHipsterOptions(command.options);
            },
        });
    }

    get [BaseApplicationGenerator.PROMPTING]() {
        return this.asPromptingTaskGroup({
            async prompting({ control }) {
                if (control.existingProject && this.options.askAnswered !== true) return;
                await this.prompt(this.prepareQuestions(command.configs));
            },
        });
    }

    get [BaseApplicationGenerator.COMPOSING]() {
        return this.asComposingTaskGroup({
            async composingTemplateTask() {
                await this.composeWithJHipster(GENERATOR_DOCKER);

                if (this.jhipsterConfigWithDefaults.buildTool === 'maven') {
                    const mavenGenerator = await this.composeWithJHipster(GENERATOR_MAVEN);
                    // Not officially supported at v8.0.0 drop maven generator when support lands.
                    mavenGenerator.savePomStorage = false;
                }
                if (this.jhipsterConfigWithDefaults.buildTool === 'gradle') {
                    await this.composeWithJHipster(GENERATOR_GRADLE);
                }

                const languagesGenerator = await this.composeWithJHipster(GENERATOR_LANGUAGES);
                languagesGenerator.writeJavaLanguageFiles = true;

                if (this.jhipsterConfigWithDefaults.databaseType === 'sql') {
                    const liquibaseGenerator = await this.composeWithJHipster(GENERATOR_LIQUIBASE);
                    liquibaseGenerator.injectLogs = false;
                    liquibaseGenerator.injectBuildTool = false;
                }
            },
        });
    }

    get [BaseApplicationGenerator.PREPARING]() {
        return this.asPreparingTaskGroup({
            async preparingTemplateTask({ source, application }) {
                source.addEntryToCache = ({ entry }) => {
                    this.editFile(
                        `${application.srcMainResources}application.properties`,
                        createNeedleCallback({
                            contentToAdd:
                                `quarkus.hibernate-orm.cache."${entry}".expiration.max-idle=${CACHE_EXPIRE_AFTER_WRITE}\n` +
                                `quarkus.hibernate-orm.cache."${entry}".memory.object-count=${CACHE_MAXIMUM_SIZE}`,
                            needle: 'quarkus-hibernate-cache-add-entry',
                        }),
                    );
                };
            },
        });
    }

    get [BaseApplicationGenerator.PREPARING_EACH_ENTITY]() {
        return this.asPreparingTaskGroup({
            async prepareQuarkusRendering({ entity }) {
                entity.dataAccess = entity.dataAccess ?? DEFAULT_DATA_ACCESS;
                entity.viaService = entity.service !== 'no';
                entity.hasServiceImpl = entity.service === 'serviceImpl';
                entity.viaRepository = entity.dataAccess === 'repository';
                entity.paginationAny = entity.pagination !== 'no';

                entity.dataAccessObject = entity.viaRepository ? `${entity.entityInstance}Repository` : entity.entityClass;
                entity.mapper = `${entity.entityInstance}Mapper`;
                entity.entityToDtoMethodReference = `${entity.mapper}::toDto`;
                entity.entityToDtoMethodInvocation = `${entity.mapper}.toDto`;
                entity.serviceClassName = entity.hasServiceImpl ? `${entity.entityClass}ServiceImpl` : `${entity.entityClass}Service`;
            },
        });
    }

    get [BaseApplicationGenerator.POST_PREPARING_EACH_ENTITY]() {
        return this.asPreparingTaskGroup({
            async prepareQuarkusRendering({ entity }) {
                entity.mapsIdAssoc = undefined;
                entity.primaryKeyType = entity.primaryKey.type;
                // eslint-disable-next-line no-restricted-syntax
                for (const relationship of entity.relationships) {
                    if (relationship.id) {
                        entity.mapsIdAssoc = relationship;
                        entity.primaryKeyType =
                            relationship.otherEntityName === 'user' && entity.authenticationType === 'oauth2'
                                ? 'String'
                                : entity.primaryKey.type;
                        break;
                    }
                }
                entity.isUsingMapsId = entity.mapsIdAssoc !== undefined;
                entity.fieldsContainOwnerManyToMany = entity.relationships.some(rel => rel.relationshipType === 'many-to-many');
                entity.fieldsContainEmbedded = entity.relationships.some(rel => rel.otherEntity.embedded);
            },
        });
    }

    get [BaseApplicationGenerator.WRITING]() {
        return this.asWritingTaskGroup({
            async writingTemplateTask({ application }) {
                await this.writeFiles({
                    sections: serverFiles,
                    context: application,
                });
            },
        });
    }

    get [BaseApplicationGenerator.WRITING_ENTITIES]() {
        return this.asWritingTaskGroup({
            async writeMicronautServerFiles({ application, entities }) {
                for (const entity of entities.filter(entity => !entity.skipServer && !entity.builtIn)) {
                    this.writeFiles({
                        sections: entityQuarkusFiles,
                        context: { ...application, ...entity },
                    });
                }
            },
        });
    }

    get [BaseApplicationGenerator.POST_WRITING]() {
        return this.asPostWritingTaskGroup({
            updatePackageJsonScripts({ application }) {
                this.packageJson.merge({
                    scripts: {
                        'ci:backend:test': 'npm run backend:info && npm run backend:doc:test && npm run backend:unit:test',
                    },
                });
                if (application.buildToolGradle) {
                    this.packageJson.merge({
                        scripts: {
                            'ci:native:prod': './gradlew build -Dquarkus.package.type=native -x webapp -x test',
                            'ci:e2e:dev': 'concurrently -k -s first "./gradlew" "npm run e2e:headless"',
                            'ci:e2e:server:start':
                                'java -jar build/quarkus-app/quarkus-run.$npm_package_config_packaging -Dquarkus.profile=$npm_package_config_default_environment',
                            'java:jar': './gradlew build -x test -x integrationTest',
                        },
                    });
                } else {
                    this.packageJson.merge({
                        scripts: {
                            'ci:native:prod': './mvnw verify -Pnative,-webapp',
                            'ci:e2e:dev': 'concurrently -k -s first "./mvnw" "npm run e2e:headless"',
                            'ci:e2e:server:start':
                                'java -jar target/quarkus-app/quarkus-run.$npm_package_config_packaging -Dquarkus.profile=$npm_package_config_default_environment',
                        },
                    });
                }
            },
        });
    }

    get [BaseApplicationGenerator.POST_WRITING_ENTITIES]() {
        return this.asPostWritingEntitiesTaskGroup({
            async postWritingEntitiesTemplateTask({ application, entities }) {
                for (const entity of entities.filter(entity => !entity.builtIn && !entity.skipServer && entity.dtoMapstruct)) {
                    this.editFile(
                        `${application.srcTestJava}/${application.packageFolder}/service/dto/${entity.dtoClass}Test.java`,
                        content =>
                            content
                                .replaceAll('web.rest.TestUtil', 'TestUtil')
                                .replaceAll('getId()', 'id')
                                .replaceAll(/setId\((.+)\)/g, 'id = $1'),
                    );

                    this.editFile(
                        `${application.srcTestJava}/${application.packageFolder}/service/mapper/${entity.entityClass}MapperTest.java`,
                        content => content.replaceAll('getId()', 'id'),
                    );
                }
            },
            updateCacheConfiguration({ source, entities, application }) {
                if (!application.enableHibernateCache) return;
                for (const entity of entities.filter(entity => !entity.builtIn && !entity.skipServer)) {
                    const entityCache = `${application.packageName}.domain.${entity.persistClass}`;
                    source.addEntryToCache({ entry: entityCache });
                    for (const relationship of entity.relationships.filter(rel => rel.collection)) {
                        source.addEntryToCache({ entry: `${entityCache}.${relationship.relationshipFieldNamePlural}` });
                    }
                }
            },
        });
    }

    get [BaseApplicationGenerator.END]() {
        return this.asEndTaskGroup({
            end() {
                this.log.ok('Quarkus application generated successfully.');

                let executable = 'mvnw';
                if (this.buildTool === 'gradle') {
                    executable = 'gradlew';
                }
                let logMsgComment = '';
                if (os.platform() === 'win32') {
                    logMsgComment = ` (${chalk.yellow.bold(executable)} if using Windows Command Prompt)`;
                }
                this.log(chalk.green(`Run your Quarkus application:\n${chalk.yellow.bold(`./${executable}`)}${logMsgComment}`));
            },
        });
    }
}
